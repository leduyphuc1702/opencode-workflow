import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import {
  BreakRequest,
  ClarificationCheckpointData,
  ContextCheckpoint,
  EvidenceEvent,
  ResumePackage,
  WorkflowArtifact,
  WorkflowArtifactKind,
} from "@/workflow/protocol"
import { WorkflowRuntime } from "@/workflow/runtime"
import { SessionID } from "@/session/schema"

const sessionID = Schema.decodeUnknownSync(SessionID)("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K")
const subagentSessionId = Schema.decodeUnknownSync(SessionID)("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2L")

describe("workflow.protocol", () => {
  test("workflow artifact kinds include clarification checkpoints", () => {
    expect(Schema.decodeUnknownSync(WorkflowArtifactKind)("clarification_checkpoint")).toBe("clarification_checkpoint")
  })

  test("clarification checkpoint data decodes only complete answered checkpoints", () => {
    const decode = Schema.decodeUnknownResult(ClarificationCheckpointData)

    expect(
      Result.isSuccess(
        decode({
          readyToPlan: true,
          synthesis: "Scope clarified.",
          options: [{ id: "minimal", label: "Minimal", tradeoffs: ["Smallest safe change"] }],
          questions: [{ question: "Use minimal scope?", options: ["Yes", "No"], answer: "Yes" }],
          selectedOption: "minimal",
          unresolvedConstraints: [],
        }),
      ),
    ).toBe(true)
    expect(
      Result.isSuccess(
        decode({
          readyToPlan: true,
          synthesis: "Missing question answer.",
          options: [{ id: "minimal", label: "Minimal", tradeoffs: [] }],
          questions: [{ question: "Use minimal scope?", options: ["Yes", "No"] }],
          unresolvedConstraints: [],
        }),
      ),
    ).toBe(false)
  })

  test("requires break requests to carry resume context evidence", () => {
    const decode = Schema.decodeUnknownResult(BreakRequest)

    expect(
      Result.isSuccess(
        decode({
          id: "brk_01J5Y5H0AH4Q4NXJ6P4C3P5V2M",
          agent: "plan-reviewer",
          taskSlice: "Review PlanDraft",
          reason: "Missing concrete artifact",
          question: "Provide the PlanDraft to review.",
          evidenceIds: ["evd_codegraph"],
        }),
      ),
    ).toBe(true)
    expect(Result.isSuccess(decode({ id: "brk_missing", agent: "plan-reviewer" }))).toBe(false)
  })

  test("resume packages preserve the checkpoint needed to resume the same sub-agent", () => {
    const checkpoint = Schema.decodeUnknownSync(ContextCheckpoint)({
      breakRequestId: "brk_01J5Y5H0AH4Q4NXJ6P4C3P5V2M",
      sessionId: sessionID,
      subagentSessionId,
      workflowState: "plan_review",
      taskBrief: "Review PlanDraft",
      evidenceIds: ["evd_plan"],
      compactedContext: "PlanDraft and reviewer blocker summary",
    })

    const resume = Schema.decodeUnknownSync(ResumePackage)({
      breakRequestId: checkpoint.breakRequestId,
      answer: "Use this PlanDraft.",
      checkpoint,
      resumeInstruction: "Resume the same reviewer task without restarting.",
    })

    expect(resume.checkpoint.subagentSessionId).toBe(subagentSessionId)
    expect(resume.checkpoint.compactedContext).toContain("PlanDraft")
    expect(resume.checkpoint.evidenceIds).toContain("evd_plan")
  })

  test("workflow records expose break, checkpoint, resume, and evidence arrays", () => {
    const record = Schema.decodeUnknownSync(WorkflowRuntime.Record)({
      sessionID,
      state: "awaiting_plan_approval",
      updatedAt: new Date(0).toISOString(),
      evidenceIds: ["evd_graph", "evd_plan"],
      breakRequests: [],
      checkpoints: [],
      resumePackages: [],
    })

    expect(record.evidenceIds).toEqual(["evd_graph", "evd_plan"])
    expect(record.breakRequests).toEqual([])
    expect(record.checkpoints).toEqual([])
    expect(record.resumePackages).toEqual([])
  })

  test("workflow artifacts carry SOL kind, cycle, routing, and review metadata", () => {
    const artifact = Schema.decodeUnknownSync(WorkflowArtifact)({
      id: "art_01J5Y5H0AH4Q4NXJ6P4C3P5V2A",
      kind: "final_plan",
      cycle: 1,
      agent: "plan-finalizer",
      timestamp: new Date(0).toISOString(),
      summary: "Final plan for backend and frontend files",
      evidenceIds: ["evd_plan"],
      expectedChangedFiles: ["src/api.ts", "src/view.tsx"],
      reviewStatus: "approved",
      variant: "full",
    })

    expect(artifact.kind).toBe("final_plan")
    expect(artifact.cycle).toBe(1)
    expect(artifact.variant).toBe("full")
    expect(artifact.expectedChangedFiles).toHaveLength(2)
  })

  test("evidence events include approval, break, resume, and test evidence types", () => {
    const decode = Schema.decodeUnknownSync(EvidenceEvent)

    for (const type of ["approval", "break", "resume", "test", "skillopt_proposal"] as const) {
      expect(
        decode({
          id: `evd_${type}`,
          type,
          timestamp: new Date(0).toISOString(),
          summary: `${type} evidence`,
        }).type,
      ).toBe(type)
    }
  })
})
