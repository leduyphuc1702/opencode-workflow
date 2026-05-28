import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { SessionID } from "@/session/schema"
import { WorkflowEvidence } from "@/workflow/evidence"
import { WorkflowRuntime } from "@/workflow/runtime"
import { testEffect } from "../lib/effect"

const it = testEffect(WorkflowRuntime.defaultLayer.pipe(Layer.provideMerge(WorkflowEvidence.defaultLayer)))

describe("workflow.runtime", () => {
  it.effect("enforces SOL planning order after mandatory explore artifacts", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const sessionID = id("order")

      const blockedPlan = yield* runtime
        .beforeTool({
          workflowSessionID: sessionID,
          currentSessionID: sessionID,
          agent: "orchestrator-agent",
          tool: "task",
          args: { subagent_type: "plan-agent" },
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(blockedPlan)).toBe(true)
      if (!Exit.isFailure(blockedPlan)) throw new Error("expected plan-agent gate")
      expect(Cause.pretty(blockedPlan.cause)).toContain("backend_explore")

      yield* runtime.recordArtifact({ sessionID, agent: "backend-explorer", kind: "backend_explore", summary: "backend" })
      yield* runtime.recordArtifact({ sessionID, agent: "frontend-explorer", kind: "frontend_explore", summary: "frontend" })
      yield* runtime.recordArtifact({ sessionID, agent: "research-agent", kind: "research_explore", summary: "research" })
      yield* runtime.recordArtifact({ sessionID, agent: "orchestrator-agent", kind: "scope_decision", summary: "scope" })

      yield* runtime.beforeTool({
        workflowSessionID: sessionID,
        currentSessionID: sessionID,
        agent: "orchestrator-agent",
        tool: "task",
        args: { subagent_type: "plan-agent" },
      })

      const blockedReview = yield* runtime
        .beforeTool({
          workflowSessionID: sessionID,
          currentSessionID: sessionID,
          agent: "orchestrator-agent",
          tool: "task",
          args: { subagent_type: "plan-reviewer" },
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(blockedReview)).toBe(true)

      yield* runtime.recordArtifact({ sessionID, agent: "plan-agent", kind: "plan_draft", summary: "draft" })
      yield* runtime.beforeTool({
        workflowSessionID: sessionID,
        currentSessionID: sessionID,
        agent: "orchestrator-agent",
        tool: "task",
        args: { subagent_type: "plan-reviewer" },
      })

      const blockedFinalizer = yield* runtime
        .beforeTool({
          workflowSessionID: sessionID,
          currentSessionID: sessionID,
          agent: "orchestrator-agent",
          tool: "task",
          args: { subagent_type: "plan-finalizer" },
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(blockedFinalizer)).toBe(true)

      yield* runtime.recordArtifact({
        sessionID,
        agent: "plan-reviewer",
        kind: "plan_review",
        summary: "review",
        reviewStatus: "approved",
      })
      yield* runtime.beforeTool({
        workflowSessionID: sessionID,
        currentSessionID: sessionID,
        agent: "orchestrator-agent",
        tool: "task",
        args: { subagent_type: "plan-finalizer" },
      })
    }),
  )

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

      yield* runtime.recordArtifact({
        sessionID,
        agent: "plan-finalizer",
        kind: "final_plan",
        summary: "one file",
        expectedChangedFiles: ["src/example.ts"],
      })

      const approved = yield* runtime.approveFinalPlan({
        sessionID,
        agent: "orchestrator-agent",
        plan: "FinalPlan: change one file and verify with tests.",
      })

      expect(approved.record.state).toBe("implementation")
      expect(approved.record.finalPlanApprovedAt).toBeDefined()
      expect(approved.variant).toBe("lite")

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

  it.effect("routes FinalPlan approval to full when two or more files are expected", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const sessionID = id("variant")

      yield* runtime.recordArtifact({
        sessionID,
        agent: "plan-finalizer",
        kind: "final_plan",
        summary: "two files",
        expectedChangedFiles: ["src/api.ts", "src/view.tsx"],
      })

      const approved = yield* runtime.approveFinalPlan({
        sessionID,
        agent: "orchestrator-agent",
        plan: "FinalPlan: change backend and frontend.",
      })

      expect(approved.variant).toBe("full")
      expect(approved.record.variant).toBe("full")
    }),
  )

  it.effect("requires backend implementation before frontend mutation in full workflow", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const sessionID = id("full")

      yield* runtime.recordArtifact({
        sessionID,
        agent: "plan-finalizer",
        kind: "final_plan",
        summary: "full",
        expectedChangedFiles: ["src/server.ts", "src/client.tsx"],
      })
      yield* runtime.approveFinalPlan({
        sessionID,
        agent: "orchestrator-agent",
        plan: "FinalPlan: backend then frontend.",
      })

      const blockedDirect = yield* runtime
        .beforeTool({
          workflowSessionID: sessionID,
          currentSessionID: sessionID,
          agent: "orchestrator-agent",
          tool: "write",
          args: { filePath: "src/client.tsx" },
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(blockedDirect)).toBe(true)

      const blockedFrontend = yield* runtime
        .beforeTool({
          workflowSessionID: sessionID,
          currentSessionID: sessionID,
          agent: "frontend-agent",
          tool: "write",
          args: { filePath: "src/client.tsx" },
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(blockedFrontend)).toBe(true)
      if (!Exit.isFailure(blockedFrontend)) throw new Error("expected frontend gate")
      expect(Cause.pretty(blockedFrontend.cause)).toContain("backend_implementation")

      yield* runtime.beforeTool({
        workflowSessionID: sessionID,
        currentSessionID: sessionID,
        agent: "backend-agent",
        tool: "write",
        args: { filePath: "src/server.ts" },
      })
      yield* runtime.recordArtifact({
        sessionID,
        agent: "backend-agent",
        kind: "backend_implementation",
        summary: "backend complete",
      })
      yield* runtime.beforeTool({
        workflowSessionID: sessionID,
        currentSessionID: sessionID,
        agent: "frontend-agent",
        tool: "write",
        args: { filePath: "src/client.tsx" },
      })
    }),
  )

  it.effect("keeps implementation approval for small code review fixes", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const sessionID = id("fix")

      yield* runtime.recordArtifact({
        sessionID,
        agent: "plan-finalizer",
        kind: "final_plan",
        summary: "lite",
        expectedChangedFiles: ["src/example.ts"],
      })
      yield* runtime.approveFinalPlan({ sessionID, agent: "orchestrator-agent", plan: "FinalPlan" })
      yield* runtime.recordArtifact({ sessionID, agent: "orchestrator-agent", kind: "implementation", summary: "done" })
      const reviewed = yield* runtime.recordArtifact({
        sessionID,
        agent: "code-reviewer",
        kind: "code_review",
        summary: "needs fix",
        reviewStatus: "needs_fix",
      })

      expect(reviewed.record.cycle).toBe(0)
      expect(reviewed.record.state).toBe("implementation")
      expect(reviewed.record.finalPlanApprovedAt).toBeDefined()

      const blockedDone = yield* runtime
        .approveDone({ sessionID, agent: "orchestrator-agent", summary: "done" })
        .pipe(Effect.exit)
      expect(Exit.isFailure(blockedDone)).toBe(true)

      yield* runtime.beforeTool({
        workflowSessionID: sessionID,
        currentSessionID: sessionID,
        agent: "orchestrator-agent",
        tool: "write",
        args: { filePath: "src/example.ts" },
      })
    }),
  )

  it.effect("restarts planning when code review is blocked", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const sessionID = id("blocked-review")

      yield* runtime.recordArtifact({
        sessionID,
        agent: "plan-finalizer",
        kind: "final_plan",
        summary: "lite",
        expectedChangedFiles: ["src/example.ts"],
      })
      yield* runtime.approveFinalPlan({ sessionID, agent: "orchestrator-agent", plan: "FinalPlan" })
      yield* runtime.recordArtifact({ sessionID, agent: "orchestrator-agent", kind: "implementation", summary: "done" })
      const reviewed = yield* runtime.recordArtifact({
        sessionID,
        agent: "code-reviewer",
        kind: "code_review",
        summary: "blocked",
        reviewStatus: "blocked",
      })

      expect(reviewed.record.cycle).toBe(1)
      expect(reviewed.record.finalPlanApprovedAt).toBeUndefined()

      const blockedWrite = yield* runtime
        .beforeTool({
          workflowSessionID: sessionID,
          currentSessionID: sessionID,
          agent: "orchestrator-agent",
          tool: "write",
          args: { filePath: "src/example.ts" },
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(blockedWrite)).toBe(true)
    }),
  )

  it.effect("blocks git commit until commit approval after done approval", () =>
    Effect.gen(function* () {
      const runtime = yield* WorkflowRuntime.Service
      const sessionID = id("commit")

      yield* runtime.recordArtifact({
        sessionID,
        agent: "plan-finalizer",
        kind: "final_plan",
        summary: "lite",
        expectedChangedFiles: ["src/example.ts"],
      })
      yield* runtime.approveFinalPlan({ sessionID, agent: "orchestrator-agent", plan: "FinalPlan" })
      yield* runtime.recordArtifact({ sessionID, agent: "orchestrator-agent", kind: "implementation", summary: "done" })
      yield* runtime.recordArtifact({
        sessionID,
        agent: "code-reviewer",
        kind: "code_review",
        summary: "clean",
        reviewStatus: "no_findings",
      })
      yield* runtime.approveDone({ sessionID, agent: "orchestrator-agent", summary: "done" })

      const blocked = yield* runtime
        .beforeTool({
          workflowSessionID: sessionID,
          currentSessionID: sessionID,
          agent: "orchestrator-agent",
          tool: "bash",
          args: { command: 'git commit -m "test"' },
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(blocked)).toBe(true)

      yield* runtime.approveCommit({ sessionID, agent: "orchestrator-agent", summary: "commit" })
      yield* runtime.beforeTool({
        workflowSessionID: sessionID,
        currentSessionID: sessionID,
        agent: "orchestrator-agent",
        tool: "bash",
        args: { command: 'git commit -m "test"' },
      })
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
