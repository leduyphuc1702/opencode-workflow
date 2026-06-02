import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SecurityFinding } from "@/security/finding"
import { WorkflowRuntime } from "@/workflow/runtime"
import {
  WorkflowArtifactKind,
  WorkflowReviewStatus,
  WorkflowRiskLevel,
  WorkflowSecurityFinding,
  WorkflowVariant,
  type WorkflowArtifact,
} from "@/workflow/protocol"
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

const RecordArtifactParameters = Schema.Struct({
  kind: WorkflowArtifactKind.annotate({ description: "SOL workflow artifact kind to record." }),
  summary: Schema.String.annotate({ description: "Concise artifact summary." }),
  data: Schema.optional(Schema.Unknown).annotate({ description: "Optional structured artifact payload." }),
  evidenceIds: EvidenceIds,
  expectedChangedFiles: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Files expected to change. Used by final_plan to choose lite vs full.",
  }),
  reviewStatus: Schema.optional(WorkflowReviewStatus).annotate({
    description: "Review result for plan_review, code_review, or skillopt_review artifacts.",
  }),
  variant: Schema.optional(WorkflowVariant).annotate({ description: "Optional explicit SOL workflow variant." }),
  risk_label: Schema.optional(WorkflowRiskLevel).annotate({ description: "Optional security risk label." }),
  security_finding: Schema.optional(WorkflowSecurityFinding).annotate({
    description: "Optional structured security finding.",
  }),
})

const ApprovalParameters = Schema.Struct({
  summary: Schema.String.annotate({ description: "What the user is approving." }),
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
          const sessionID = yield* workflowSessionID(sessions, ctx)
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

export const WorkflowRecordArtifactTool = Tool.define<typeof RecordArtifactParameters, Metadata, Services>(
  "workflow_record_artifact",
  Effect.gen(function* () {
    const runtime = yield* WorkflowRuntime.Service
    const sessions = yield* Session.Service

    return {
      description:
        "Record a typed SOL workflow artifact. Use this after each required SOL step before moving to the next step.",
      parameters: RecordArtifactParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const sessionID = yield* workflowSessionID(sessions, ctx)
          const result = yield* runtime.recordArtifact({
            sessionID,
            agent: ctx.agent,
            kind: params.kind,
            summary: params.summary,
            data: params.data,
            evidenceIds: params.evidenceIds ?? [],
            expectedChangedFiles: params.expectedChangedFiles ?? undefined,
            reviewStatus: params.reviewStatus,
            variant: params.variant,
            risk_label: params.risk_label,
            security_finding: params.security_finding,
          })
          return {
            title: `Artifact ${result.artifact.kind}`,
            metadata: { state: result.record.state, evidenceID: result.evidenceID },
            output: JSON.stringify(
              { artifact: result.artifact, state: result.record.state, evidenceID: result.evidenceID },
              null,
              2,
            ),
          }
        }).pipe(Effect.orDie),
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
          const sessionID = yield* workflowSessionID(sessions, ctx)
          const record = yield* runtime.get(sessionID)
          const finalPlan = record.artifacts
            ?.filter((artifact) => artifact.kind === "final_plan" && artifact.cycle === (record.cycle ?? 0))
            .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
          if (!finalPlan) return yield* Effect.fail(new Error("workflow_approve_plan requires a final_plan artifact."))
          const answers = yield* question.ask({
            sessionID,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            questions: [
              {
                header: "FinalPlan",
                question: approvalQuestion("Approve this FinalPlan and allow implementation to start?", finalPlan),
                custom: true,
                options: [
                  { label: "Approve", description: "Unlock implementation tools for this workflow session." },
                  { label: "Revise", description: "Keep implementation blocked and start a new planning cycle." },
                ],
              },
            ],
          })

          if (answers[0]?.[0] !== "Approve") {
            const result = yield* runtime.restartPlanning({
              sessionID,
              agent: ctx.agent,
              reason: answers[0]?.join("\n") || "User requested FinalPlan revision.",
            })
            return {
              title: "FinalPlan not approved",
              metadata: { state: result.record.state, evidenceID: result.evidenceID },
              output: "User did not approve the FinalPlan. Implementation remains blocked and a new planning cycle is required.",
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
              `FinalPlan approved as ${result.variant}. Implementation tools are now unlocked for session ${sessionID}.`,
              `Approval evidence: ${result.evidenceID}`,
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WorkflowApproveDoneTool = Tool.define<typeof ApprovalParameters, Metadata, Services>(
  "workflow_approve_done",
  Effect.gen(function* () {
    const runtime = yield* WorkflowRuntime.Service
    const question = yield* Question.Service
    const sessions = yield* Session.Service

    return {
      description: "Ask the user to approve the completed SOL task before offering commit approval.",
      parameters: ApprovalParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const sessionID = yield* workflowSessionID(sessions, ctx)
          const record = yield* runtime.get(sessionID)
          const review = latestArtifact(record, "code_review")
          const answers = yield* question.ask({
            sessionID,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            questions: [
              {
                header: "Done",
                question: approvalQuestion("Approve this task as done?", review),
                custom: true,
                options: [
                  { label: "Approve", description: "Mark this SOL workflow done." },
                  { label: "Revise", description: "Keep the workflow open." },
                ],
              },
            ],
          })
          if (answers[0]?.[0] !== "Approve") {
            const record = yield* runtime.transition({ sessionID, state: "awaiting_done_approval" })
            return {
              title: "Done not approved",
              metadata: { state: record.state },
              output: "User did not approve done status. Continue the SOL workflow.",
            }
          }
          const result = yield* runtime.approveDone({
            sessionID,
            agent: ctx.agent,
            summary: params.summary,
            evidenceIds: params.evidenceIds ?? [],
          })
          return {
            title: "Done approved",
            metadata: { state: result.record.state, evidenceID: result.evidenceID },
            output: `Done approved. Approval evidence: ${result.evidenceID}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const WorkflowApproveCommitTool = Tool.define<typeof ApprovalParameters, Metadata, Services>(
  "workflow_approve_commit",
  Effect.gen(function* () {
    const runtime = yield* WorkflowRuntime.Service
    const question = yield* Question.Service
    const sessions = yield* Session.Service

    return {
      description: "Ask the user to approve staging and committing after SOL done approval.",
      parameters: ApprovalParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const sessionID = yield* workflowSessionID(sessions, ctx)
          const record = yield* runtime.get(sessionID)
          const riskArtifact = latestArtifact(record, "done_approval") ?? latestArtifact(record, "code_review")
          const answers = yield* question.ask({
            sessionID,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            questions: [
              {
                header: "Commit",
                question: approvalQuestion("Commit the approved changes?", riskArtifact),
                custom: true,
                options: [
                  { label: "Commit", description: "Unlock git add and git commit commands for this workflow." },
                  { label: "Skip", description: "Do not commit now." },
                ],
              },
            ],
          })
          if (answers[0]?.[0] !== "Commit") {
            const record = yield* runtime.transition({ sessionID, state: "awaiting_commit_approval" })
            return {
              title: "Commit not approved",
              metadata: { state: record.state },
              output: "User did not approve committing. Git add and git commit commands remain blocked.",
            }
          }
          const result = yield* runtime.approveCommit({
            sessionID,
            agent: ctx.agent,
            summary: params.summary,
            evidenceIds: params.evidenceIds ?? [],
          })
          return {
            title: "Commit approved",
            metadata: { state: result.record.state, evidenceID: result.evidenceID },
            output: `Commit approved. Git add and git commit commands are unlocked. Approval evidence: ${result.evidenceID}`,
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
          const sessionID = yield* workflowSessionID(sessions, ctx)
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
          const sessionID = yield* workflowSessionID(sessions, ctx)
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

function workflowSessionID(sessions: Session.Interface, ctx: Tool.Context) {
  return Effect.gen(function* () {
    const workflowSessionID = ctx.extra?.workflowSessionID
    if (typeof workflowSessionID === "string") return SessionID.make(workflowSessionID)
    const info = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
    return info.parentID ?? ctx.sessionID
  })
}

function approvalQuestion(question: string, artifact: WorkflowArtifact | undefined) {
  const line = securityLine(artifact)
  if (!line) return question
  return `${question}\n\n${line}`
}

function securityLine(artifact: WorkflowArtifact | undefined) {
  if (artifact?.security_finding && !SecurityFinding.isEmpty(artifact.security_finding)) {
    return SecurityFinding.summarize(artifact.security_finding)
  }
  if (artifact?.risk_label) return `Security: ${artifact.risk_label}`
}

function latestArtifact(record: { artifacts?: readonly WorkflowArtifact[]; cycle?: number }, kind: WorkflowArtifact["kind"]) {
  return (record.artifacts ?? [])
    .filter((artifact) => artifact.kind === kind && artifact.cycle === (record.cycle ?? 0))
    .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
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
