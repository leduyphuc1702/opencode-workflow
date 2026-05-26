import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { SessionID } from "@/session/schema"
import { WorkflowEvidence } from "@/workflow/evidence"
import { WorkflowRuntime } from "@/workflow/runtime"
import { testEffect } from "../lib/effect"

const it = testEffect(WorkflowRuntime.defaultLayer.pipe(Layer.provideMerge(WorkflowEvidence.defaultLayer)))

describe("workflow.runtime", () => {
  it.effect("blocks mutation until FinalPlan approval", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const sessionID = id("approval")

      const blocked = yield* runtime
        .beforeTool({
          workflowSessionID: sessionID,
          currentSessionID: sessionID,
          agent: "implementation-agent",
          tool: "write",
          args: { filePath: "/tmp/example.ts" },
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(blocked)).toBe(true)
      if (!Exit.isFailure(blocked)) throw new Error("expected workflow gate to block write")
      expect(Cause.pretty(blocked.cause)).toContain("Workflow approval gate blocked write")

      const approved = yield* runtime.approveFinalPlan({
        sessionID,
        agent: "orchestrator-agent",
        plan: "FinalPlan: change one file and verify with tests.",
      })

      expect(approved.record.state).toBe("implementation")
      expect(approved.record.finalPlanApprovedAt).toBeDefined()

      const allowed = yield* runtime.beforeTool({
        workflowSessionID: sessionID,
        currentSessionID: sessionID,
        agent: "implementation-agent",
        tool: "write",
        args: { filePath: "/tmp/example.ts" },
      })

      expect(allowed.warning).toBeUndefined()
    }),
  )

  it.effect("records raw fallback evidence before graph evidence", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const evidence = yield* WorkflowEvidence.Service
      const rawSessionID = id("raw")

      const result = yield* runtime.beforeTool({
        workflowSessionID: rawSessionID,
        currentSessionID: rawSessionID,
        agent: "plan-agent",
        tool: "grep",
        args: { pattern: "WorkflowRuntime" },
      })

      expect(result.warning).toContain("Raw fallback evidence recorded")
      expect((yield* evidence.list(rawSessionID)).some((event) => event.type === "raw_fallback")).toBe(true)
    }),
  )

  it.effect("persists break checkpoints and resume packages", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const sessionID = id("break")
      const subagentSessionID = id("subagent")

      const blocked = yield* runtime.checkpointBreak({
        sessionID,
        subagentSessionID,
        agent: "implementation-agent",
        taskSlice: "Choose migration strategy",
        reason: "Two compatible approaches require product input.",
        question: "Use strict or permissive migration?",
        options: ["Strict", "Permissive"],
        compactedContext: "Need user decision before editing migration code.",
      })

      expect(blocked.breakRequest.id.startsWith("brk_")).toBe(true)
      expect(blocked.checkpoint.subagentSessionId).toBe(subagentSessionID)

      const resumed = yield* runtime.resumeBreak({
        sessionID,
        breakRequestId: blocked.breakRequest.id,
        answer: "Strict",
      })

      expect(resumed.resumePackage.answer).toBe("Strict")
      expect(resumed.resumePackage.checkpoint.breakRequestId).toBe(blocked.breakRequest.id)
      expect(resumed.record.resumePackages.map((item) => item.breakRequestId)).toContain(blocked.breakRequest.id)
    }),
  )
})

function id(name: string) {
  return SessionID.make(`ses_workflow_runtime_${name}_${Date.now()}_${Math.random().toString(16).slice(2)}`)
}
