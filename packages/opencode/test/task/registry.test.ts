import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { TaskRegistry } from "@/task/registry"
import { TaskGateState } from "@/task/gate-state"
import { TaskGate, MAX_TASK_GATE_MAIN_REACT } from "@/task/gate"
import { testEffect } from "../lib/effect"

const TestLayer = Layer.mergeAll(
  TaskRegistry.defaultLayer,
  TaskGateState.defaultLayer,
  SessionNs.layer.pipe(
    Layer.provide(Bus.layer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
    Layer.provide(BackgroundJob.defaultLayer),
  ),
)

const it = testEffect(TestLayer)

describe("task.registry", () => {
  it.instance("hierarchical ids, lifecycle transitions, events, archival", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const reg = yield* TaskRegistry.Service
      const s = (yield* sessions.create({})).id

      const t1 = yield* reg.create({ session_id: s, summary: "first" })
      const t2 = yield* reg.create({ session_id: s, summary: "second" })
      expect(t1.id).toBe("T1")
      expect(t2.id).toBe("T2")
      const child = yield* reg.create({ session_id: s, summary: "child", parent_id: "T1" })
      expect(child.id).toBe("T1.1")

      // start -> in_progress + owner; idempotent same owner; handoff different owner
      const started = yield* reg.start({ session_id: s, id: "T1", owner: "actor_a" })
      expect(started.status).toBe("in_progress")
      expect(started.owner).toBe("actor_a")
      const restart = yield* reg.start({ session_id: s, id: "T1", owner: "actor_a" })
      expect(restart.owner).toBe("actor_a")
      const handoff = yield* reg.start({ session_id: s, id: "T1", owner: "actor_b" })
      expect(handoff.owner).toBe("actor_b")

      // block / unblock
      const blocked = yield* reg.block({ session_id: s, id: "T2", event_summary: "waiting" })
      expect(blocked.status).toBe("blocked")
      const unblocked = yield* reg.unblock({ session_id: s, id: "T2" })
      expect(unblocked.status).toBe("open")

      // rename
      const renamed = yield* reg.rename({ session_id: s, id: "T2", summary: "renamed" })
      expect(renamed.summary).toBe("renamed")

      // done stamps ended_at + cleanup_after
      const done = yield* reg.done({ session_id: s, id: "T1", event_summary: "complete" })
      expect(done.status).toBe("done")
      expect(typeof done.ended_at).toBe("number")
      expect(typeof done.cleanup_after).toBe("number")

      // start on terminal task is refused (no-op, stays done)
      const refused = yield* reg.start({ session_id: s, id: "T1" })
      expect(refused.status).toBe("done")

      // abandon
      const abandoned = yield* reg.abandon({ session_id: s, id: "T1.1", event_summary: "not needed" })
      expect(abandoned.status).toBe("abandoned")
      expect(typeof abandoned.ended_at).toBe("number")

      // events log for T1: created, started, started (handoff), done
      const events = yield* reg.events({ session_id: s, task_id: "T1" })
      const kinds = events.map((e) => e.kind)
      expect(kinds[0]).toBe("created")
      expect(kinds).toContain("started")
      expect(kinds).toContain("done")

      // list excludes terminal by default, includes with include_terminal
      const active = yield* reg.list({ session_id: s })
      expect(active.map((t) => t.id).sort()).toEqual(["T2"])
      const all = yield* reg.list({ session_id: s, include_terminal: true })
      expect(all.length).toBe(3)
    }),
  )

  it.instance("task gate: open task triggers re-entry; done clears it", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionNs.Service
      const reg = yield* TaskRegistry.Service
      const gateState = yield* TaskGateState.Service
      const s = (yield* sessions.create({})).id

      yield* reg.create({ session_id: s, summary: "open work" })

      const count = yield* gateState.get(s)
      const d1 = yield* TaskGate.decide({
        session_id: s,
        reactCount: count,
        maxReact: MAX_TASK_GATE_MAIN_REACT,
        mode: "main",
      })
      expect(d1.needReentry).toBe(true)

      yield* reg.done({ session_id: s, id: "T1", event_summary: "done" })
      const d2 = yield* TaskGate.decide({
        session_id: s,
        reactCount: 0,
        maxReact: MAX_TASK_GATE_MAIN_REACT,
        mode: "main",
      })
      expect(d2.needReentry).toBe(false)
      expect(d2.incompleteTasks).toEqual([])
    }),
  )
})
