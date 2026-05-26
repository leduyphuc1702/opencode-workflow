import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { WorkflowRuntime } from "@/workflow/runtime"
import { Question } from "@/question"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

type Metadata = {
  state?: string
  evidenceID?: string
  breakRequestID?: string
  subagentSessionID?: string
}

type Services = WorkflowRuntime.Service | Question.Service | Session.Service

const Empty = Schema.Struct({})
const EvidenceIds = Schema.optional(Schema.Array(Schema.String)).annotate({
  description: "Evidence event ids that support this workflow action.",
})

const ApprovePlanParameters = Schema.Struct({
  plan: Schema.String.annotate({ description: "The complete FinalPlan text that the user is approving." }),
  evidenceIds: EvidenceIds,
})

const BreakParameters = Schema.Struct({
  taskSlice: Schema.String.annotate({ description: "The smallest task slice currently blocked." }),
  reason: Schema.String.annotate({ description: "Why the sub-agent cannot continue without user input." }),
  question: Schema.String.annotate({ description: "The exact question for the orchestrator to ask the user." }),
  options: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Optional answer choices." }),
  evidenceIds: EvidenceIds,
  compactedContext: Schema.optional(Schema.String).annotate({
    description: "Compact summary of the sub-agent context needed to resume without restarting.",
  }),
})

const ResumeParameters = Schema.Struct({
  breakRequestId: Schema.String.annotate({ description: "BreakRequest id returned by workflow_break." }),
  answer: Schema.String.annotate({ description: "The user's answer collected by the orchestrator." }),
  resumeInstruction: Schema.optional(Schema.String).annotate({
    description: "Optional instruction to include in the ResumePackage.",
  }),
})

export const WorkflowStateTool = Tool.define<typeof Empty, Metadata, Services>(
  "workflow_state",
  Effect.gen(function* () {
    const runtime = yield* WorkflowRuntime.Service
    const sessions = yield* Session.Service

    return {
      description: "Return the persisted opencode-workflow state for this session.",
      parameters: Empty,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const sessionID = yield* workflowSessionID(sessions, ctx.sessionID)
          const record = yield* runtime.get(sessionID)
          return {
            title: `Workflow ${record.state}`,
            metadata: { state: record.state },
            output: JSON.stringify(record, null, 2),
          }
        }),
    }
  }),
)

export const WorkflowApprovePlanTool = Tool.define<typeof ApprovePlanParameters, Metadata, Services>(
  "workflow_approve_plan",
  Effect.gen(function* () {
    const runtime = yield* WorkflowRuntime.Service
    const question = yield* Question.Service
    const sessions = yield* Session.Service

    return {
      description:
        "Ask the user to approve the FinalPlan and unlock implementation tools only after approval is granted.",
      parameters: ApprovePlanParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const sessionID = yield* workflowSessionID(sessions, ctx.sessionID)
          const answers = yield* question.ask({
            sessionID,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            questions: [
              {
                header: "FinalPlan",
                question: "Approve this FinalPlan and allow implementation to start?",
                custom: false,
                options: [
                  { label: "Approve", description: "Unlock implementation tools for this workflow session." },
                  { label: "Revise", description: "Keep implementation blocked and revise the plan." },
                ],
              },
            ],
          })

          if (answers[0]?.[0] !== "Approve") {
            const record = yield* runtime.transition({ sessionID, state: "awaiting_plan_approval" })
            return {
              title: "FinalPlan not approved",
              metadata: { state: record.state },
              output: "User did not approve the FinalPlan. Implementation remains blocked.",
            }
          }

          const result = yield* runtime.approveFinalPlan({
            sessionID,
            agent: ctx.agent,
            plan: params.plan,
            evidenceIds: params.evidenceIds ?? [],
          })
          return {
            title: "FinalPlan approved",
            metadata: { state: result.record.state, evidenceID: result.evidenceID },
            output: [
              `FinalPlan approved. Implementation tools are now unlocked for session ${sessionID}.`,
              `Approval evidence: ${result.evidenceID}`,
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WorkflowBreakTool = Tool.define<typeof BreakParameters, Metadata, Services>(
  "workflow_break",
  Effect.gen(function* () {
    const runtime = yield* WorkflowRuntime.Service
    const sessions = yield* Session.Service

    return {
      description:
        "Sub-agent break mechanism. Emit a BreakRequest to the orchestrator instead of asking the user directly.",
      parameters: BreakParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const sessionID = yield* workflowSessionID(sessions, ctx.sessionID)
          const result = yield* runtime.checkpointBreak({
            sessionID,
            subagentSessionID: ctx.sessionID,
            agent: ctx.agent,
            taskSlice: params.taskSlice,
            reason: params.reason,
            question: params.question,
            options: params.options ?? [],
            evidenceIds: params.evidenceIds ?? [],
            compactedContext: params.compactedContext ?? compactMessages(ctx.messages),
          })
          return {
            title: `BreakRequest ${result.breakRequest.id}`,
            metadata: {
              state: result.record.state,
              evidenceID: result.evidenceID,
              breakRequestID: result.breakRequest.id,
              subagentSessionID: ctx.sessionID,
            },
            output: JSON.stringify(
              {
                breakRequest: result.breakRequest,
                checkpoint: result.checkpoint,
                evidenceID: result.evidenceID,
                orchestratorInstruction:
                  "Ask the user this question, then call workflow_resume_break with the answer before resuming the same sub-agent via task_id.",
              },
              null,
              2,
            ),
          }
        }),
    }
  }),
)

export const WorkflowResumeBreakTool = Tool.define<typeof ResumeParameters, Metadata, Services>(
  "workflow_resume_break",
  Effect.gen(function* () {
    const runtime = yield* WorkflowRuntime.Service
    const sessions = yield* Session.Service

    return {
      description:
        "Create a ResumePackage from a user answer. The orchestrator should pass it to task with task_id to resume the same sub-agent session.",
      parameters: ResumeParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const sessionID = yield* workflowSessionID(sessions, ctx.sessionID)
          const result = yield* runtime.resumeBreak({
            sessionID,
            breakRequestId: params.breakRequestId,
            answer: params.answer,
            resumeInstruction: params.resumeInstruction,
          })
          const request = result.record.breakRequests.find((item) => item.id === params.breakRequestId)
          return {
            title: `ResumePackage ${params.breakRequestId}`,
            metadata: {
              state: result.record.state,
              evidenceID: result.evidenceID,
              breakRequestID: params.breakRequestId,
              subagentSessionID: result.resumePackage.checkpoint.subagentSessionId,
            },
            output: JSON.stringify(
              {
                resumePackage: result.resumePackage,
                evidenceID: result.evidenceID,
                taskResumeInput: {
                  task_id: result.resumePackage.checkpoint.subagentSessionId,
                  subagent_type: request?.agent,
                  description: `Resume ${params.breakRequestId}`,
                  prompt: [
                    "Resume from this workflow package without restarting:",
                    JSON.stringify(result.resumePackage, null, 2),
                  ].join("\n"),
                },
              },
              null,
              2,
            ),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function workflowSessionID(sessions: Session.Interface, sessionID: SessionID) {
  return Effect.gen(function* () {
    const info = yield* sessions.get(sessionID).pipe(Effect.orDie)
    return info.parentID ?? sessionID
  })
}

function compactMessages(messages: Tool.Context["messages"]) {
  return messages
    .slice(-6)
    .map((message) => {
      const parts = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n")
      return parts ? `${message.info.role}: ${parts}` : undefined
    })
    .filter(Boolean)
    .join("\n\n")
}
