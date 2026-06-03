import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, Queue } from "effect"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { WorkflowClarifyScopeTool, WorkflowRecordArtifactTool } from "@/tool/workflow"
import { WorkflowRuntime } from "@/workflow/runtime"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    WorkflowRuntime.defaultLayer,
    Question.layer.pipe(Layer.provideMerge(Bus.layer)),
    Layer.mock(Session.Service)({}),
    Truncate.defaultLayer,
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

describe("tool.workflow", () => {
  it.instance("allows workflow_clarify_scope only for orchestrator-agent", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service

      expect(Permission.evaluate("workflow_clarify_scope", "*", (yield* agents.get("orchestrator-agent")).permission).action).toBe(
        "allow",
      )
      expect(Permission.evaluate("workflow_clarify_scope", "*", (yield* agents.get("build")).permission).action).toBe(
        "deny",
      )
      expect(Permission.evaluate("workflow_clarify_scope", "*", (yield* agents.get("backend-explorer")).permission).action).toBe(
        "deny",
      )
    }),
  )

  it.instance("rejects direct clarification_checkpoint records", () =>
    Effect.gen(function* () {
      const info = yield* WorkflowRecordArtifactTool
      const tool = yield* info.init()
      const exit = yield* tool
        .execute(
          {
            kind: "clarification_checkpoint",
            summary: "ready",
            data: readyData("Minimal"),
          },
          ctx("reject"),
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) throw new Error("expected workflow_record_artifact rejection")
      expect(Cause.pretty(exit.cause)).toContain("workflow_clarify_scope")
    }),
  )

  it.instance("rejects workflow_clarify_scope without root options", () =>
    Effect.gen(function* () {
      const info = yield* WorkflowClarifyScopeTool
      const tool = yield* info.init()
      const exit = yield* tool.execute({ ...clarifyParams(), options: [] }, ctx("no_options")).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) throw new Error("expected workflow_clarify_scope rejection")
      expect(Cause.pretty(exit.cause)).toContain("at least one scope option")
    }),
  )

  it.instance("rejects workflow_clarify_scope without questions", () =>
    Effect.gen(function* () {
      const info = yield* WorkflowClarifyScopeTool
      const tool = yield* info.init()
      const exit = yield* tool.execute({ ...clarifyParams(), questions: [] }, ctx("no_questions")).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) throw new Error("expected workflow_clarify_scope rejection")
      expect(Cause.pretty(exit.cause)).toContain("at least one question")
    }),
  )

  it.instance("rejects workflow_clarify_scope question without answer options", () =>
    Effect.gen(function* () {
      const info = yield* WorkflowClarifyScopeTool
      const tool = yield* info.init()
      const exit = yield* tool
        .execute(
          { ...clarifyParams(), questions: [{ question: "Use minimal scope?", options: [] }] },
          ctx("no_answer_options"),
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) throw new Error("expected workflow_clarify_scope rejection")
      expect(Cause.pretty(exit.cause)).toContain("at least one answer option")
    }),
  )

  it.instance("asks scope questions and records clarification_checkpoint", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const runtime = yield* WorkflowRuntime.Service
      const info = yield* WorkflowClarifyScopeTool
      const tool = yield* info.init()
      const sessionID = session("clarify")
      yield* runtime.recordArtifact({ sessionID, agent: "backend-explorer", kind: "backend_explore", summary: "backend" })
      yield* runtime.recordArtifact({ sessionID, agent: "frontend-explorer", kind: "frontend_explore", summary: "frontend" })
      yield* runtime.recordArtifact({ sessionID, agent: "research-agent", kind: "research_explore", summary: "research" })
      yield* runtime.recordArtifact({ sessionID, agent: "orchestrator-agent", kind: "scope_decision", summary: "scope" })
      const run = yield* tool
        .execute(
          clarifyParams(),
          ctx("clarify", sessionID),
        )
        .pipe(Effect.forkScoped)

      const pending = yield* pendingQuestion()
      expect(pending.questions[0].question).toContain("Synthesis: Scope clarified for minimal implementation.")
      expect(pending.questions[0].question).toContain("- Minimal (minimal): Fastest")
      expect(pending.questions[0].question).toContain("Question: Use minimal scope?")
      expect(pending.questions[0].options[0]?.description).toBe("Fastest")
      expect(pending.questions[0].options[1]?.description).toBe("No")
      yield* question.reply({ requestID: pending.id, answers: [["Minimal"]] })

      const result = yield* Fiber.join(run)
      const record = yield* runtime.get(sessionID)
      const checkpoint = record.artifacts?.find((item) => item.kind === "clarification_checkpoint")

      expect(result.title).toBe("Clarification checkpoint")
      expect(record.state).toBe("planning")
      expect(checkpoint?.data).toMatchObject(readyData("Minimal"))
    }),
  )

  it.instance("rejects workflow_clarify_scope when the answer is empty", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const runtime = yield* WorkflowRuntime.Service
      const info = yield* WorkflowClarifyScopeTool
      const tool = yield* info.init()
      const sessionID = session("empty_answer")
      const run = yield* tool.execute(clarifyParams(), ctx("empty_answer", sessionID)).pipe(Effect.forkScoped)

      const pending = yield* pendingQuestion()
      yield* question.reply({ requestID: pending.id, answers: [[" "]] })

      const exit = yield* Fiber.join(run).pipe(Effect.exit)
      const record = yield* runtime.get(sessionID)

      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) throw new Error("expected workflow_clarify_scope empty-answer rejection")
      expect(Cause.pretty(exit.cause)).toContain("non-empty answer")
      expect(record.artifacts?.some((item) => item.kind === "clarification_checkpoint")).toBe(false)
    }),
  )
})

function pendingQuestion() {
  return Effect.gen(function* () {
    const question = yield* Question.Service
    const bus = yield* Bus.Service
    const asked = yield* Queue.unbounded<void>()
    const off = yield* bus.subscribeCallback(Question.Event.Asked, () => Queue.offerUnsafe(asked, undefined))
    yield* Effect.addFinalizer(() => Effect.sync(off))

    for (;;) {
      const item = (yield* question.list())[0]
      if (item) return item
      yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
    }
  })
}

function ctx(name: string, id = session(name)): Tool.Context {
  return {
    sessionID: id,
    messageID: MessageID.make(`msg_workflow_${name}`),
    callID: `call_${name}`,
    agent: "orchestrator-agent",
    abort: AbortSignal.any([]),
    extra: { workflowSessionID: id },
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

function session(name: string) {
  return SessionID.make(`ses_workflow_tool_${name}_${Date.now()}_${Math.random().toString(16).slice(2)}`)
}

function clarifyParams() {
  return {
    readyToPlan: true,
    synthesis: "Scope clarified for minimal implementation.",
    options: [{ id: "minimal", label: "Minimal", tradeoffs: ["Fastest"] }],
    questions: [{ question: "Use minimal scope?", options: ["Minimal", "No"] }],
    selectedOption: "minimal",
    unresolvedConstraints: [],
  }
}

function readyData(answer: string) {
  return {
    readyToPlan: true,
    synthesis: answer === "Minimal" ? "Scope clarified for minimal implementation." : "ready",
    options: [{ id: "minimal", label: "Minimal", tradeoffs: ["Fastest"] }],
    questions: [{ question: "Use minimal scope?", options: ["Minimal", "No"], answer }],
    selectedOption: "minimal",
    unresolvedConstraints: [],
  }
}
