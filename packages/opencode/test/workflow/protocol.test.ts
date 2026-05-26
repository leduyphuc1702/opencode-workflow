import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { BreakRequest, ContextCheckpoint, EvidenceEvent, ResumePackage } from "@/workflow/protocol"
import { WorkflowRuntime } from "@/workflow/runtime"
import { SessionID } from "@/session/schema"

const sessionID = Schema.decodeUnknownSync(SessionID)("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K")
const subagentSessionId = Schema.decodeUnknownSync(SessionID)("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2L")

describe("workflow.protocol", () => {
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

  test("evidence events include approval, break, resume, and test evidence types", () => {
    const decode = Schema.decodeUnknownSync(EvidenceEvent)

    for (const type of ["approval", "break", "resume", "test"] as const) {
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
