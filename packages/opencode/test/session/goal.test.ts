import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Goal } from "@/session/goal"
import type { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Goal.defaultLayer)

const sid = (s: string) => s as SessionID

describe("session.goal", () => {
  it.instance("set / get / clear round-trips a condition", () =>
    Effect.gen(function* () {
      const goal = yield* Goal.Service
      const s = sid("ses_goal_1")

      expect(yield* goal.get(s)).toBeUndefined()

      yield* goal.set(s, "implement binary search")
      const active = yield* goal.get(s)
      expect(active?.condition).toBe("implement binary search")
      expect(active?.react).toBe(0)

      yield* goal.clear(s)
      expect(yield* goal.get(s)).toBeUndefined()
    }),
  )

  it.instance("bumpReact increments the active goal counter, 0 when absent", () =>
    Effect.gen(function* () {
      const goal = yield* Goal.Service
      const s = sid("ses_goal_2")

      // No active goal -> bump is a no-op returning 0.
      expect(yield* goal.bumpReact(s)).toBe(0)

      yield* goal.set(s, "make tests pass")
      expect(yield* goal.bumpReact(s)).toBe(1)
      expect(yield* goal.bumpReact(s)).toBe(2)
      expect((yield* goal.get(s))?.react).toBe(2)

      // set() resets the counter.
      yield* goal.set(s, "make tests pass")
      expect((yield* goal.get(s))?.react).toBe(0)
    }),
  )

  it.instance("goals are isolated per session", () =>
    Effect.gen(function* () {
      const goal = yield* Goal.Service
      yield* goal.set(sid("ses_a"), "goal A")
      yield* goal.set(sid("ses_b"), "goal B")
      expect((yield* goal.get(sid("ses_a")))?.condition).toBe("goal A")
      expect((yield* goal.get(sid("ses_b")))?.condition).toBe("goal B")
      yield* goal.clear(sid("ses_a"))
      expect(yield* goal.get(sid("ses_a"))).toBeUndefined()
      expect((yield* goal.get(sid("ses_b")))?.condition).toBe("goal B")
    }),
  )
})
