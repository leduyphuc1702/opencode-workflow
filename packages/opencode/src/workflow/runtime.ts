import { Identifier } from "@/id/id"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { BreakRequest, ContextCheckpoint, EvidenceEvent, ResumePackage, WorkflowState } from "./protocol"
import { WorkflowEvidence } from "./evidence"

export type Record = Schema.Schema.Type<typeof Record>

export const Record = Schema.Struct({
  sessionID: SessionID,
  state: WorkflowState,
  updatedAt: Schema.String,
  evidenceIds: Schema.Array(Schema.String),
  finalPlanApprovedAt: Schema.optional(Schema.String),
  finalPlanEvidenceIds: Schema.optional(Schema.Array(Schema.String)),
  breakRequests: Schema.Array(BreakRequest),
  checkpoints: Schema.Array(ContextCheckpoint),
  resumePackages: Schema.Array(ResumePackage),
})

export type BeforeToolInput = {
  workflowSessionID: SessionID
  currentSessionID: SessionID
  agent: string
  tool: string
  args: unknown
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Record>
  readonly transition: (input: {
    sessionID: SessionID
    state: WorkflowState
    evidenceId?: string
  }) => Effect.Effect<Record>
  readonly approveFinalPlan: (input: {
    sessionID: SessionID
    agent: string
    plan: string
    evidenceIds?: readonly string[]
  }) => Effect.Effect<{ record: Record; evidenceID: string }>
  readonly beforeTool: (input: BeforeToolInput) => Effect.Effect<{ warning?: string }, Error>
  readonly checkpointBreak: (input: {
    sessionID: SessionID
    subagentSessionID: SessionID
    agent: string
    taskSlice: string
    reason: string
    question: string
    options?: readonly string[]
    evidenceIds?: readonly string[]
    compactedContext: string
  }) => Effect.Effect<{ record: Record; breakRequest: BreakRequest; checkpoint: ContextCheckpoint; evidenceID: string }>
  readonly resumeBreak: (input: {
    sessionID: SessionID
    breakRequestId: string
    answer: string
    resumeInstruction?: string
  }) => Effect.Effect<{ record: Record; resumePackage: ResumePackage; evidenceID: string }, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkflowRuntime") {}

const decodeRecord = Schema.decodeUnknownOption(Record)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    const evidence = yield* WorkflowEvidence.Service
    const flags = yield* RuntimeFlags.Service

    const get: Interface["get"] = Effect.fn("WorkflowRuntime.get")(function* (sessionID) {
      const raw = yield* storage.read<unknown>(key(sessionID)).pipe(
        Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
        Effect.orDie,
      )
      const decoded = decodeRecord(raw, { onExcessProperty: "preserve" })
      if (Option.isSome(decoded)) return decoded.value
      return initial(sessionID)
    })

    const save = Effect.fn("WorkflowRuntime.save")(function* (record: Record) {
      yield* storage.write(key(record.sessionID), { ...record, updatedAt: new Date().toISOString() }).pipe(Effect.orDie)
      return yield* get(record.sessionID)
    })

    const transition: Interface["transition"] = Effect.fn("WorkflowRuntime.transition")(function* (input) {
      const record = yield* get(input.sessionID)
      return yield* save({
        ...record,
        state: input.state,
        evidenceIds: input.evidenceId ? unique([...record.evidenceIds, input.evidenceId]) : record.evidenceIds,
      })
    })

    const approveFinalPlan: Interface["approveFinalPlan"] = Effect.fn("WorkflowRuntime.approveFinalPlan")(function* (
      input,
    ) {
      const event = yield* evidence.append({
        sessionID: input.sessionID,
        type: "approval",
        summary: "FinalPlan approved for implementation",
        data: {
          agent: input.agent,
          plan: input.plan,
          evidenceIds: input.evidenceIds ?? [],
        },
      })
      const record = yield* get(input.sessionID)
      const approved = yield* save({
        ...record,
        state: "implementation",
        finalPlanApprovedAt: event.timestamp,
        finalPlanEvidenceIds: unique([...(input.evidenceIds ?? []), event.id]),
        evidenceIds: unique([...record.evidenceIds, ...(input.evidenceIds ?? []), event.id]),
      })
      return { record: approved, evidenceID: event.id }
    })

    const beforeTool: Interface["beforeTool"] = Effect.fn("WorkflowRuntime.beforeTool")(function* (input) {
      if (!workflowAgents.has(input.agent)) return {}
      if (mutatingTools.has(input.tool)) {
        const record = yield* get(input.workflowSessionID)
        if (!record.finalPlanApprovedAt) {
          return yield* Effect.fail(
            new Error(
              [
                `Workflow approval gate blocked ${input.tool}.`,
                "Implementation tools are disabled until the user approves the FinalPlan.",
                "Use workflow_approve_plan after plan review, then retry this tool call.",
              ].join(" "),
            ),
          )
        }
      }

      if (!rawFallbackTools.has(input.tool)) return {}

      const graphReady = yield* hasGraphEvidence(input.currentSessionID, input.workflowSessionID)
      const event = yield* evidence.append({
        sessionID: input.currentSessionID,
        type: "raw_fallback",
        summary: graphReady ? `Raw ${input.tool} used after graph evidence` : `Raw ${input.tool} used before graph evidence`,
        data: {
          tool: input.tool,
          agent: input.agent,
          args: input.args,
          graphEvidencePresent: graphReady,
        },
      })
      const record = yield* get(input.workflowSessionID)
      yield* save({ ...record, evidenceIds: unique([...record.evidenceIds, event.id]) })

      if (flags.workflowStrictGraphFirst && !graphReady) {
        return yield* Effect.fail(
          new Error(
            [
              `Graph-first gate blocked ${input.tool}.`,
              "Use codebase_status/codebase_context/codebase_search_symbol/codebase_node/codebase_trace/codebase_explore first.",
              `Fallback evidence recorded as ${event.id}.`,
            ].join(" "),
          ),
        )
      }

      return {
        warning: graphReady
          ? undefined
          : `Raw fallback evidence recorded (${event.id}); CodeGraph should be the default exploration path.`,
      }
    })

    const checkpointBreak: Interface["checkpointBreak"] = Effect.fn("WorkflowRuntime.checkpointBreak")(function* (
      input,
    ) {
      const breakRequest: BreakRequest = {
        id: Identifier.create("brk", "ascending"),
        agent: input.agent,
        taskSlice: input.taskSlice,
        reason: input.reason,
        question: input.question,
        options: input.options ? [...input.options] : undefined,
        evidenceIds: [...(input.evidenceIds ?? [])],
      }
      const record = yield* get(input.sessionID)
      const checkpoint: ContextCheckpoint = {
        breakRequestId: breakRequest.id,
        sessionId: input.sessionID,
        subagentSessionId: input.subagentSessionID,
        workflowState: record.state,
        taskBrief: input.taskSlice,
        evidenceIds: breakRequest.evidenceIds,
        compactedContext: input.compactedContext,
      }
      const event = yield* evidence.append({
        sessionID: input.sessionID,
        type: "break",
        summary: `Sub-agent ${input.agent} requested orchestrator help`,
        data: { breakRequest, checkpoint },
      })
      const saved = yield* save({
        ...record,
        state: record.state,
        evidenceIds: unique([...record.evidenceIds, event.id, ...breakRequest.evidenceIds]),
        breakRequests: [...record.breakRequests.filter((item) => item.id !== breakRequest.id), breakRequest],
        checkpoints: [...record.checkpoints.filter((item) => item.breakRequestId !== breakRequest.id), checkpoint],
      })
      return { record: saved, breakRequest, checkpoint, evidenceID: event.id }
    })

    const resumeBreak: Interface["resumeBreak"] = Effect.fn("WorkflowRuntime.resumeBreak")(function* (input) {
      const record = yield* get(input.sessionID)
      const checkpoint = record.checkpoints.find((item) => item.breakRequestId === input.breakRequestId)
      if (!checkpoint) {
        return yield* Effect.fail(new Error(`BreakRequest not found: ${input.breakRequestId}`))
      }
      const resumePackage: ResumePackage = {
        breakRequestId: input.breakRequestId,
        answer: input.answer,
        checkpoint,
        resumeInstruction:
          input.resumeInstruction ??
          [
            "Resume the interrupted sub-agent task with the user's answer.",
            "Keep prior task context and evidence in mind.",
            "Do not restart the task from scratch.",
          ].join(" "),
      }
      const event = yield* evidence.append({
        sessionID: input.sessionID,
        type: "resume",
        summary: `Resume package created for ${input.breakRequestId}`,
        data: resumePackage,
      })
      const saved = yield* save({
        ...record,
        evidenceIds: unique([...record.evidenceIds, event.id]),
        resumePackages: [...record.resumePackages.filter((item) => item.breakRequestId !== input.breakRequestId), resumePackage],
      })
      return { record: saved, resumePackage, evidenceID: event.id }
    })

    const hasGraphEvidence = Effect.fn("WorkflowRuntime.hasGraphEvidence")(function* (
      currentSessionID: SessionID,
      workflowSessionID: SessionID,
    ) {
      const current = yield* evidence.list(currentSessionID)
      if (current.some(isGraphEvidence)) return true
      if (currentSessionID === workflowSessionID) return false
      return (yield* evidence.list(workflowSessionID)).some(isGraphEvidence)
    })

    return Service.of({ get, transition, approveFinalPlan, beforeTool, checkpointBreak, resumeBreak })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Storage.defaultLayer),
  Layer.provide(WorkflowEvidence.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

function key(sessionID: SessionID) {
  return ["workflow_runtime", sessionID]
}

function initial(sessionID: SessionID): Record {
  return {
    sessionID,
    state: "intake",
    updatedAt: new Date().toISOString(),
    evidenceIds: [],
    breakRequests: [],
    checkpoints: [],
    resumePackages: [],
  }
}

function isGraphEvidence(event: EvidenceEvent) {
  return event.type === "graph_sync" || event.type === "graph_query" || event.type === "impact"
}

function unique(items: readonly string[]) {
  return [...new Set(items)]
}

const workflowAgents = new Set([
  "orchestrator-agent",
  "plan-agent",
  "plan-reviewer",
  "plan-finalizer",
  "implementation-agent",
  "code-reviewer",
])

const mutatingTools = new Set(["edit", "write", "apply_patch", "bash"])
const rawFallbackTools = new Set(["read", "grep", "glob"])

export * as WorkflowRuntime from "./runtime"
