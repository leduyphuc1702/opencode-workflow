import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionID } from "@/session/schema"
import { WorkflowEvidence } from "@/workflow/evidence"
import { WorkflowRuntime } from "@/workflow/runtime"
import { testEffect } from "../lib/effect"

const it = testEffect(WorkflowRuntime.defaultLayer.pipe(Layer.provideMerge(WorkflowEvidence.defaultLayer)))

describe("workflow.orchestration-drill", () => {
  it.effect("runs the golden break/resume orchestration sequence with deterministic evidence", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const evidence = yield* WorkflowEvidence.Service
      const sessionID = id("golden")
      const reviewerSessionID = id("plan_reviewer")
      const order: string[] = []

      const codegraph = yield* evidence.append({
        sessionID,
        type: "graph_query",
        summary: "CodeGraph context gathered before PlanDraft",
        data: { tool: "codebase_context", target: "workflow_evidence_matrix" },
      })
      order.push("codegraph")

      const planDraft = [
        "PlanDraft: add workflow_evidence_matrix.",
        "Evidence: CodeGraph context must exist before review.",
        "Verification: workflow drill test and package-local typecheck.",
      ].join("\n")
      const plan = yield* evidence.append({
        sessionID,
        type: "test",
        summary: "PlanDraft fixture created",
        data: { artifact: "PlanDraft", content: planDraft, dependsOn: codegraph.id },
      })
      order.push("plan")

      const blocked = yield* runtime.checkpointBreak({
        sessionID,
        subagentSessionID: reviewerSessionID,
        agent: "plan-reviewer",
        taskSlice: "Review PlanDraft artifact",
        reason: "PlanDraft artifact was missing from the reviewer prompt.",
        question: "Provide the real PlanDraft artifact before review.",
        evidenceIds: [codegraph.id],
        compactedContext: "Reviewer must break instead of reviewing assumptions.",
      })
      order.push("break")

      expect(blocked.breakRequest.agent).toBe("plan-reviewer")
      expect(blocked.breakRequest.question).toContain("PlanDraft")
      expect(blocked.checkpoint.subagentSessionId).toBe(reviewerSessionID)

      const resumed = yield* runtime.resumeBreak({
        sessionID,
        breakRequestId: blocked.breakRequest.id,
        answer: planDraft,
        resumeInstruction: "Resume the same plan-reviewer session and review only the provided PlanDraft artifact.",
      })
      order.push("resume")

      expect(resumed.resumePackage.checkpoint.subagentSessionId).toBe(reviewerSessionID)
      expect(resumed.resumePackage.answer).toBe(planDraft)

      const review = yield* evidence.append({
        sessionID,
        type: "test",
        summary: "Reviewer reviewed real PlanDraft artifact after resume",
        data: { task_id: reviewerSessionID, artifactEvidenceID: plan.id, resumeEvidenceID: resumed.evidenceID },
      })
      order.push("review")

      const matrix = [
        row("CodeGraph before PlanDraft", "CodeGraph evidence", codegraph.id, "event order", "pass"),
        row("PlanDraft before review", "PlanDraft fixture", plan.id, "event order", "pass"),
        row("Missing artifact creates break", "BreakRequest", blocked.evidenceID, "checkpoint fields", "pass"),
        row("Resume same task id", "ResumePackage", resumed.evidenceID, reviewerSessionID, "pass"),
        row("Reviewer uses real artifact", "review fixture", review.id, "artifactEvidenceID present", "pass"),
      ]
      const finalizer = yield* evidence.append({
        sessionID,
        type: "test",
        summary: "Finalizer produced evidence matrix",
        data: { matrix },
      })
      order.push("finalizer")

      expect(order).toEqual(["codegraph", "plan", "break", "resume", "review", "finalizer"])
      expect(matrix.map((item) => item.Evidence)).toEqual([
        codegraph.id,
        plan.id,
        blocked.evidenceID,
        resumed.evidenceID,
        review.id,
      ])
      expect(matrix.every((item) => item.Gap === "none")).toBe(true)
      expect(finalizer.summary).toContain("evidence matrix")

      const persisted = yield* runtime.get(sessionID)
      expect(persisted.breakRequests.map((item) => item.id)).toContain(blocked.breakRequest.id)
      expect(persisted.resumePackages.map((item) => item.breakRequestId)).toContain(blocked.breakRequest.id)
    }),
  )
})

function row(
  Requirement: string,
  Artifact: string,
  Evidence: string,
  Verification: string,
  Status: "pass" | "fail",
) {
  return { Requirement, Artifact, Evidence, Verification, Status, Gap: "none" }
}

function id(name: string) {
  return SessionID.make(`ses_workflow_drill_${name}_${Date.now()}_${Math.random().toString(16).slice(2)}`)
}
