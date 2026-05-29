import { Identifier } from "@/id/id"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Context, Effect, Layer, Option, Schema } from "effect"
import {
  BreakRequest,
  ContextCheckpoint,
  EvidenceEvent,
  ResumePackage,
  WorkflowArtifact,
  WorkflowArtifactKind,
  WorkflowReviewStatus,
  WorkflowState,
  WorkflowVariant,
} from "./protocol"
import { WorkflowEvidence } from "./evidence"

export type Record = Schema.Schema.Type<typeof Record>

export const Record = Schema.Struct({
  sessionID: SessionID,
  state: WorkflowState,
  updatedAt: Schema.String,
  evidenceIds: Schema.Array(Schema.String),
  cycle: Schema.optional(Schema.Int),
  variant: Schema.optional(WorkflowVariant),
  artifacts: Schema.optional(Schema.Array(WorkflowArtifact)),
  approvedPlan: Schema.optional(WorkflowArtifact),
  finalPlanApprovedAt: Schema.optional(Schema.String),
  finalPlanEvidenceIds: Schema.optional(Schema.Array(Schema.String)),
  doneApprovedAt: Schema.optional(Schema.String),
  commitApprovedAt: Schema.optional(Schema.String),
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
  readonly recordArtifact: (input: {
    sessionID: SessionID
    agent: string
    kind: WorkflowArtifactKind
    summary: string
    data?: unknown
    evidenceIds?: readonly string[]
    expectedChangedFiles?: readonly string[]
    reviewStatus?: WorkflowReviewStatus
    variant?: WorkflowVariant
  }) => Effect.Effect<{ record: Record; artifact: WorkflowArtifact; evidenceID: string }>
  readonly approveFinalPlan: (input: {
    sessionID: SessionID
    agent: string
    plan: string
    evidenceIds?: readonly string[]
  }) => Effect.Effect<{ record: Record; evidenceID: string; variant: WorkflowVariant }, Error>
  readonly restartPlanning: (input: {
    sessionID: SessionID
    agent: string
    reason: string
  }) => Effect.Effect<{ record: Record; evidenceID: string }>
  readonly approveDone: (input: {
    sessionID: SessionID
    agent: string
    summary: string
    evidenceIds?: readonly string[]
  }) => Effect.Effect<{ record: Record; artifact: WorkflowArtifact; evidenceID: string }, Error>
  readonly approveCommit: (input: {
    sessionID: SessionID
    agent: string
    summary: string
    evidenceIds?: readonly string[]
  }) => Effect.Effect<{ record: Record; artifact: WorkflowArtifact; evidenceID: string }, Error>
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
      if (Option.isSome(decoded)) return normalize(decoded.value, sessionID)
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

    const recordArtifact: Interface["recordArtifact"] = Effect.fn("WorkflowRuntime.recordArtifact")(function* (
      input,
    ) {
      const record = yield* get(input.sessionID)
      const cycle = record.cycle ?? 0
      const artifact: WorkflowArtifact = {
        id: Identifier.create("art", "ascending"),
        kind: input.kind,
        cycle,
        agent: input.agent,
        timestamp: new Date().toISOString(),
        summary: input.summary,
        data: input.data,
        evidenceIds: [...(input.evidenceIds ?? [])],
        expectedChangedFiles: input.expectedChangedFiles ? [...input.expectedChangedFiles] : undefined,
        reviewStatus: input.reviewStatus,
        variant: input.variant,
      }
      const event = yield* evidence.append({
        sessionID: input.sessionID,
        type: evidenceType(input.kind),
        summary: `Workflow artifact recorded: ${input.kind}`,
        data: artifact,
      })
      const nextArtifacts = [...(record.artifacts ?? []), { ...artifact, evidenceIds: unique([...artifact.evidenceIds, event.id]) }]
      const restartsPlanning = input.kind === "code_review" && input.reviewStatus === "blocked"
      const saved = yield* save({
        ...record,
        state: restartsPlanning ? "planning" : stateAfterArtifact(input.kind, input.reviewStatus),
        cycle: restartsPlanning ? cycle + 1 : cycle,
        variant: restartsPlanning ? undefined : input.variant ?? record.variant,
        approvedPlan: restartsPlanning ? undefined : record.approvedPlan,
        finalPlanApprovedAt: restartsPlanning ? undefined : record.finalPlanApprovedAt,
        finalPlanEvidenceIds: restartsPlanning ? undefined : record.finalPlanEvidenceIds,
        evidenceIds: unique([...record.evidenceIds, event.id, ...artifact.evidenceIds]),
        artifacts: nextArtifacts,
      })
      return { record: saved, artifact: nextArtifacts[nextArtifacts.length - 1]!, evidenceID: event.id }
    })

    const approveFinalPlan: Interface["approveFinalPlan"] = Effect.fn("WorkflowRuntime.approveFinalPlan")(function* (
      input,
    ) {
      const record = yield* get(input.sessionID)
      const plan = latestArtifact(record, "final_plan")
      if (!plan) return yield* Effect.fail(new Error("FinalPlan approval requires a recorded final_plan artifact."))
      if (plan.cycle !== (record.cycle ?? 0)) {
        return yield* Effect.fail(new Error("FinalPlan approval requires a final_plan artifact from the current cycle."))
      }
      const variant: WorkflowVariant = (plan.expectedChangedFiles?.length ?? 0) >= 2 ? "full" : "lite"
      const event = yield* evidence.append({
        sessionID: input.sessionID,
        type: "approval",
        summary: "FinalPlan approved for implementation",
        data: {
          agent: input.agent,
          plan: input.plan,
          planArtifact: plan.id,
          variant,
          evidenceIds: input.evidenceIds ?? [],
        },
      })
      const approved = yield* save({
        ...record,
        state: "implementation",
        variant,
        approvedPlan: { ...plan, variant },
        finalPlanApprovedAt: event.timestamp,
        finalPlanEvidenceIds: unique([...(input.evidenceIds ?? []), event.id]),
        evidenceIds: unique([...record.evidenceIds, ...(input.evidenceIds ?? []), event.id]),
      })
      return { record: approved, evidenceID: event.id, variant }
    })

    const restartPlanning: Interface["restartPlanning"] = Effect.fn("WorkflowRuntime.restartPlanning")(function* (
      input,
    ) {
      const record = yield* get(input.sessionID)
      const event = yield* evidence.append({
        sessionID: input.sessionID,
        type: "approval",
        summary: "FinalPlan revision requested",
        data: { agent: input.agent, reason: input.reason, cycle: record.cycle ?? 0 },
      })
      const saved = yield* save({
        ...record,
        state: "planning",
        cycle: (record.cycle ?? 0) + 1,
        variant: undefined,
        approvedPlan: undefined,
        finalPlanApprovedAt: undefined,
        finalPlanEvidenceIds: undefined,
        evidenceIds: unique([...record.evidenceIds, event.id]),
      })
      return { record: saved, evidenceID: event.id }
    })

    const approveDone: Interface["approveDone"] = Effect.fn("WorkflowRuntime.approveDone")(function* (input) {
      const record = yield* get(input.sessionID)
      const review = latestArtifact(record, "code_review")
      if (!review || review.cycle !== (record.cycle ?? 0)) {
        return yield* Effect.fail(new Error("Done approval requires a code_review artifact from the current cycle."))
      }
      if (review.reviewStatus === "needs_fix" || review.reviewStatus === "blocked") {
        return yield* Effect.fail(new Error("Done approval is blocked until code_review has no blocking findings."))
      }
      const skillEvidence = (yield* evidence.list(input.sessionID)).some((event) => event.type === "skillopt_proposal")
      if (skillEvidence && !latestArtifact(record, "skillopt_review")) {
        return yield* Effect.fail(new Error("Done approval requires skillopt_review because one or more skills were used."))
      }
      const result = yield* recordArtifact({
        sessionID: input.sessionID,
        agent: input.agent,
        kind: "done_approval",
        summary: input.summary,
        evidenceIds: input.evidenceIds ?? [],
      })
      const saved = yield* save({ ...result.record, state: "done", doneApprovedAt: result.artifact.timestamp })
      return { ...result, record: saved }
    })

    const approveCommit: Interface["approveCommit"] = Effect.fn("WorkflowRuntime.approveCommit")(function* (input) {
      const record = yield* get(input.sessionID)
      if (!record.doneApprovedAt) return yield* Effect.fail(new Error("Commit approval requires done approval first."))
      const result = yield* recordArtifact({
        sessionID: input.sessionID,
        agent: input.agent,
        kind: "commit_approval",
        summary: input.summary,
        evidenceIds: input.evidenceIds ?? [],
      })
      const saved = yield* save({ ...result.record, state: "done", commitApprovedAt: result.artifact.timestamp })
      return { ...result, record: saved }
    })

    const beforeTool: Interface["beforeTool"] = Effect.fn("WorkflowRuntime.beforeTool")(function* (input) {
      if (!workflowAgents.has(input.agent)) return {}
      const record = yield* get(input.workflowSessionID)

      if (input.tool === "task") {
        const blocker = taskBlocker(record, taskAgent(input.args))
        if (blocker) return yield* Effect.fail(new Error(blocker))
      }

      const commitApproved = currentCommitApproved(record)

      if (input.tool === "bash" && isCommitCommand(input.args) && !commitApproved) {
        return yield* Effect.fail(
          new Error("Workflow commit gate blocked git commit. Use workflow_approve_commit after done approval."),
        )
      }

      if (input.tool === "bash" && commitApproved && isCommitWorkflowCommand(input.args)) return {}

      if (mutatingTools.has(input.tool) || (input.tool === "bash" && isLikelyMutatingShell(input.args))) {
        const blocker = mutationBlocker(record, input)
        if (blocker) return yield* Effect.fail(new Error(blocker))
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

    return Service.of({
      get,
      transition,
      recordArtifact,
      approveFinalPlan,
      restartPlanning,
      approveDone,
      approveCommit,
      beforeTool,
      checkpointBreak,
      resumeBreak,
    })
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
    cycle: 0,
    artifacts: [],
    breakRequests: [],
    checkpoints: [],
    resumePackages: [],
  }
}

function normalize(record: Record, sessionID: SessionID): Record {
  return {
    ...record,
    sessionID,
    cycle: record.cycle ?? 0,
    artifacts: record.artifacts ?? [],
    breakRequests: record.breakRequests ?? [],
    checkpoints: record.checkpoints ?? [],
    resumePackages: record.resumePackages ?? [],
  }
}

function latestArtifact(record: Record, kind: WorkflowArtifactKind) {
  return (record.artifacts ?? [])
    .filter((artifact) => artifact.kind === kind)
    .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
}

function hasCurrentArtifact(record: Record, kind: WorkflowArtifactKind) {
  return (record.artifacts ?? []).some((artifact) => artifact.kind === kind && artifact.cycle === (record.cycle ?? 0))
}

function hasCurrentArtifacts(record: Record, kinds: readonly WorkflowArtifactKind[]) {
  return kinds.every((kind) => hasCurrentArtifact(record, kind))
}

function currentPlanApproved(record: Record) {
  return !!record.finalPlanApprovedAt && record.approvedPlan?.cycle === (record.cycle ?? 0)
}

function currentCommitApproved(record: Record) {
  return !!record.commitApprovedAt && hasCurrentArtifact(record, "commit_approval")
}

function stateAfterArtifact(kind: WorkflowArtifactKind, reviewStatus?: WorkflowReviewStatus): WorkflowState {
  if (kind === "intake_spec") return "exploring"
  if (kind === "scope_decision") return "planning"
  if (kind === "plan_draft") return "plan_review"
  if (kind === "plan_review") return "plan_finalizing"
  if (kind === "final_plan") return "awaiting_plan_approval"
  if (kind === "code_review" && reviewStatus === "needs_fix") return "implementation"
  if (kind === "code_review" && reviewStatus === "blocked") return "planning"
  if (kind === "code_review") return "awaiting_done_approval"
  if (kind === "done_approval") return "done"
  if (kind === "commit_approval") return "done"
  if (kind.endsWith("_explore")) return "exploring"
  if (kind.endsWith("_implementation") || kind === "implementation") return "implementation"
  return "planning"
}

function evidenceType(kind: WorkflowArtifactKind): WorkflowEvidence.CreateInput["type"] {
  if (kind === "done_approval" || kind === "commit_approval") return "approval"
  if (kind === "code_review") return "test"
  if (kind === "skillopt_review") return "skillopt_proposal"
  return "graph_query"
}

function taskBlocker(record: Record, agent: string | undefined) {
  if (!agent) return
  if (agent === "plan-agent" && !hasCurrentArtifacts(record, exploreAndScopeArtifacts)) {
    return "SOL gate blocked plan-agent. Record backend_explore, frontend_explore, research_explore, and scope_decision first."
  }
  if (agent === "plan-reviewer" && !hasCurrentArtifact(record, "plan_draft")) {
    return "SOL gate blocked plan-reviewer. Record a plan_draft artifact first."
  }
  if (agent === "plan-finalizer" && !hasCurrentArtifact(record, "plan_review")) {
    return "SOL gate blocked plan-finalizer. Record a plan_review artifact first."
  }
  if (implementationAgents.has(agent) && !currentPlanApproved(record)) {
    return "SOL gate blocked implementation agent. Approve the current final_plan with workflow_approve_plan first."
  }
  if (agent === "frontend-agent" && record.variant === "full" && !hasCurrentArtifact(record, "backend_implementation")) {
    return "SOL gate blocked frontend-agent. Record backend_implementation before frontend implementation."
  }
  if (agent === "code-reviewer" && !implementationReady(record)) {
    return "SOL gate blocked code-reviewer. Record implementation artifacts before review."
  }
}

function mutationBlocker(record: Record, input: BeforeToolInput) {
  if (!currentPlanApproved(record)) {
    return `Workflow approval gate blocked ${input.tool}. Implementation tools are disabled until the user approves the FinalPlan.`
  }
  if (record.variant === "full") {
    if (input.agent === "orchestrator-agent" || input.agent === "implementation-agent") {
      return "SOL full workflow gate blocked direct implementation. Use backend-agent then frontend-agent."
    }
    if (input.agent === "frontend-agent" && !hasCurrentArtifact(record, "backend_implementation")) {
      return "SOL full workflow gate blocked frontend mutation. Record backend_implementation first."
    }
  }
}

function implementationReady(record: Record) {
  if (record.variant === "full") {
    return hasCurrentArtifact(record, "backend_implementation") && hasCurrentArtifact(record, "frontend_implementation")
  }
  return hasCurrentArtifact(record, "implementation") || hasCurrentArtifact(record, "backend_implementation")
}

function taskAgent(args: unknown) {
  if (!args || typeof args !== "object") return
  const value = (args as { subagent_type?: unknown }).subagent_type
  return typeof value === "string" ? value : undefined
}

function shellCommand(args: unknown) {
  if (!args || typeof args !== "object") return ""
  const value = (args as { command?: unknown }).command
  return typeof value === "string" ? value : ""
}

function isCommitCommand(args: unknown) {
  return /(^|[;&|]\s*)(git|jj)\s+commit\b/.test(shellCommand(args))
}

function isCommitWorkflowCommand(args: unknown) {
  return /^\s*(?:git\s+add\b[^\n;&|<>]*|(?:git|jj)\s+commit\b[^\n;&|<>]*|git\s+add\b[^\n;&|<>]*&&\s*(?:git|jj)\s+commit\b[^\n;&|<>]*)\s*$/.test(
    shellCommand(args),
  )
}

function isLikelyMutatingShell(args: unknown) {
  const command = shellCommand(args)
  if (!command) return false
  return (
    /(^|[;&|]\s*)(apply_patch|rm|mv|cp|mkdir|touch|chmod|chown)\b/.test(command) ||
    /(^|[;&|]\s*)git\s+(add|reset|checkout|merge|rebase|cherry-pick)\b/.test(command) ||
    /(^|[;&|]\s*)(bun|npm|pnpm|yarn)\s+(add|install|remove|update)\b/.test(command) ||
    /\bsed\s+-i\b/.test(command) ||
    /(^|[^<])>\s*[^&]/.test(command)
  )
}

function isGraphEvidence(event: EvidenceEvent) {
  return event.type === "graph_sync" || event.type === "graph_query" || event.type === "impact"
}

function unique(items: readonly string[]) {
  return [...new Set(items)]
}

const workflowAgents = new Set([
  "orchestrator-agent",
  "backend-explorer",
  "frontend-explorer",
  "research-agent",
  "plan-agent",
  "plan-reviewer",
  "plan-finalizer",
  "backend-agent",
  "frontend-agent",
  "implementation-agent",
  "code-reviewer",
  "skillopt-agent",
])

const implementationAgents = new Set(["backend-agent", "frontend-agent", "implementation-agent"])
const exploreAndScopeArtifacts = [
  "backend_explore",
  "frontend_explore",
  "research_explore",
  "scope_decision",
] as const
const mutatingTools = new Set(["edit", "write", "apply_patch"])
const rawFallbackTools = new Set(["read", "grep", "glob"])

export * as WorkflowRuntime from "./runtime"
