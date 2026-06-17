import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Skill } from "../../src/skill"
import { Discovery } from "../../src/skill/discovery"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { composeSkillsBlock } from "../../src/skill/compose/extract"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(Skill.defaultLayer, node))
const itDisabled = testEffect(
  Layer.mergeAll(
    Skill.layer.pipe(
      Layer.provide(Discovery.defaultLayer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Global.layer),
      Layer.provide(RuntimeFlags.layer({ disableComposeSkills: true })),
    ),
    node,
  ),
)

describe("skill.compose", () => {
  it.instance("registers compose skills, hidden from available but loadable by name", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service

      const all = (yield* skill.all()).map((s) => s.name)
      expect(all).toContain("compose:tdd")
      expect(all).toContain("compose:brainstorm")

      // Hidden: excluded from the available-skills listing (no agent filter).
      const available = (yield* skill.available()).map((s) => s.name)
      expect(available).not.toContain("compose:tdd")
      expect(available).not.toContain("compose:brainstorm")

      // But still loadable by name.
      const tdd = yield* skill.require("compose:tdd")
      expect(tdd.name).toBe("compose:tdd")
      expect(tdd.content.length).toBeGreaterThan(0)
      expect(tdd.hidden).toBe(true)
    }),
  )

  it.instance("composeSkillsBlock lists the bundled skills", () =>
    Effect.gen(function* () {
      const block = yield* Effect.promise(() => composeSkillsBlock())
      expect(block).toContain("<compose_skills>")
      expect(block).toContain("<name>compose:tdd</name>")
      expect(block).toContain("<location>")
    }),
  )

  itDisabled.instance("OPENCODE_DISABLE_COMPOSE_SKILLS hides the bundle entirely", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const all = (yield* skill.all()).map((s) => s.name)
      expect(all).not.toContain("compose:tdd")
      expect(all).not.toContain("compose:brainstorm")
    }),
  )
})
