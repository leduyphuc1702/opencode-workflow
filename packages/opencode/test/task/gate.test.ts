import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { TaskGate, MAX_TASK_GATE_MAIN_REACT, MAX_TASK_GATE_SUBAGENT_REACT } from "@/task/gate"
import { TaskRegistry } from "@/task/registry"
import type { Task } from "@/task/schema"
import type { SessionID } from "@/session/schema"
import { it } from "../lib/effect"

const task = (id: string, status: Task["status"], summary = "do " + id): Task => ({
  id,
  session_id: "ses_gate" as SessionID,
  status,
  summary,
  created_at: 0,
  last_event_at: 0,
})

const decide = (tasks: Task[], input: Parameters<typeof TaskGate.decide>[0]) =>
  TaskGate.decide(input).pipe(
    // include_terminal:false is honored by the real registry; the mock returns
    // exactly what decide should filter (open/in_progress kept, blocked dropped).
    Effect.provideService(TaskRegistry.Service, { list: () => Effect.succeed(tasks) } as any),
  )

const base = { session_id: "ses_gate" as SessionID, reactCount: 0, maxReact: MAX_TASK_GATE_MAIN_REACT, mode: "main" as const }

describe("task.gate.decide", () => {
  it.effect("no actionable tasks -> no re-entry", () =>
    Effect.gen(function* () {
      const d = yield* decide([], base)
      expect(d).toEqual({ needReentry: false, capExceeded: false, incompleteTasks: [] })
    }),
  )

  it.effect("blocked tasks are excluded from actionable", () =>
    Effect.gen(function* () {
      const d = yield* decide([task("T1", "blocked")], base)
      expect(d.needReentry).toBe(false)
      expect(d.capExceeded).toBe(false)
    }),
  )

  it.effect("open/in_progress tasks trigger re-entry with nudge text", () =>
    Effect.gen(function* () {
      const d = yield* decide([task("T1", "open"), task("T2", "in_progress")], base)
      expect(d.needReentry).toBe(true)
      if (d.needReentry) {
        expect(d.incompleteTasks).toEqual(["T1", "T2"])
        expect(d.reentryText).toContain("still unfinished")
        expect(d.reentryText).toContain("T1 (open)")
      }
    }),
  )

  it.effect("cap exceeded -> no re-entry, capExceeded true", () =>
    Effect.gen(function* () {
      const d = yield* decide([task("T1", "open")], { ...base, reactCount: MAX_TASK_GATE_MAIN_REACT })
      expect(d.needReentry).toBe(false)
      expect(d.capExceeded).toBe(true)
      if (d.capExceeded) expect(d.incompleteTasks).toEqual(["T1"])
    }),
  )

  it.effect("subagent headline differs from main", () =>
    Effect.gen(function* () {
      const sub = yield* decide([task("T1", "open")], {
        ...base,
        mode: "subagent",
        maxReact: MAX_TASK_GATE_SUBAGENT_REACT,
      })
      if (sub.needReentry) expect(sub.reentryText).toContain("tasks you own")
    }),
  )
})
