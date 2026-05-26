import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Cause, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import { createHash } from "crypto"
import { rm } from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { WorkflowEvidence } from "@/workflow/evidence"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node, WorkflowEvidence.defaultLayer))

describe("tool.skill", () => {
  it.live("execute returns skill content block with files", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const skill = path.join(dir, ".opencode", "skill", "tool-skill")
        yield* Effect.promise(() =>
          Bun.write(
            path.join(skill, "SKILL.md"),
            `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
`,
          ),
        )
        yield* Effect.promise(() => Bun.write(path.join(skill, "scripts", "demo.txt"), "demo"))

        const home = process.env.OPENCODE_TEST_HOME
        process.env.OPENCODE_TEST_HOME = dir
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            process.env.OPENCODE_TEST_HOME = home
          }),
        )

        const registry = yield* ToolRegistry.Service
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const tool = (yield* registry.tools({
          providerID: "opencode" as any,
          modelID: "gpt-5" as any,
          agent,
        })).find((tool) => tool.id === SkillTool.id)
        if (!tool) throw new Error("Skill tool not found")

        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const ctx: Tool.Context = {
          ...baseCtx,
          ask: (req) =>
            Effect.sync(() => {
              requests.push(req)
            }),
        }

        const result = yield* tool.execute({ name: "tool-skill" }, ctx)
        const file = path.resolve(skill, "scripts", "demo.txt")

        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("skill")
        expect(requests[0].patterns).toContain("tool-skill")
        expect(requests[0].always).toContain("tool-skill")
        expect(result.metadata.dir).toBe(skill)
        expect(result.output).toContain(`<skill_content name="tool-skill">`)
        expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(skill).href}`)
        expect(result.output).toContain(`<file>${file}</file>`)
      }),
    ),
  )

  it.live("execute preserves not found message", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const home = process.env.OPENCODE_TEST_HOME
        process.env.OPENCODE_TEST_HOME = dir
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            process.env.OPENCODE_TEST_HOME = home
          }),
        )

        const registry = yield* ToolRegistry.Service
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const tool = (yield* registry.tools({
          providerID: "opencode" as any,
          modelID: "gpt-5" as any,
          agent,
        })).find((tool) => tool.id === SkillTool.id)
        if (!tool) throw new Error("Skill tool not found")

        const exit = yield* tool
          .execute(
            { name: "missing-skill" },
            {
              ...baseCtx,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause)
          expect(error).toBeInstanceOf(Error)
          if (error instanceof Error) expect(error.message).toContain('Skill "missing-skill" not found.')
        }
      }),
    ),
  )

  it.live("records remote skill lease with content hash and source metadata", () =>
    Effect.gen(function* () {
      const name = "remote-lease-skill"
      const content = [
        "---",
        `name: ${name}`,
        "description: Remote lease test skill.",
        "---",
        "",
        "# Remote Lease Skill",
        "",
        "Use this skill for lease evidence tests.",
        "",
      ].join("\n")
      yield* Effect.promise(() => rm(path.join(Global.Path.cache, "skills", name), { recursive: true, force: true }))
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/skills/index.json") {
            return Response.json({ skills: [{ name, files: ["SKILL.md"] }] })
          }
          if (url.pathname === `/skills/${name}/SKILL.md`) return new Response(content)
          return new Response("Not Found", { status: 404 })
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => void server.stop(true)))

      const base = `http://localhost:${server.port}/skills/`
      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const tool = (yield* registry.tools({
              providerID: "opencode" as any,
              modelID: "gpt-5" as any,
              agent: { name: "build", mode: "primary" as const, permission: [], options: {} },
            })).find((tool) => tool.id === SkillTool.id)
            if (!tool) throw new Error("Skill tool not found")

            const ctx: Tool.Context = {
              ...baseCtx,
              sessionID: SessionID.make("ses_remote_lease_test"),
              ask: () => Effect.void,
            }
            const result = yield* tool.execute({ name }, ctx)
            const evidence = yield* WorkflowEvidence.Service
            const event = (yield* evidence.list(ctx.sessionID)).find((event) => event.type === "skill_lease")
            if (!event || typeof event.data !== "object" || event.data === null) {
              throw new Error("missing skill lease evidence")
            }
            const data = event.data as Record<string, unknown>
            const sourceUrl = new URL(`${name}/`, base).href
            const rawContentUrl = new URL("SKILL.md", sourceUrl).href
            const contentSha256 = createHash("sha256").update(content).digest("hex")
            const lease = result.metadata.lease as
              | { contentSha256?: string; sourceUrl?: string; rawContentUrl?: string }
              | undefined

            expect(result.output).toContain(`<task_scoped_remote_skill_lease evidence="${event.id}"`)
            expect(lease?.contentSha256).toBe(contentSha256)
            expect(lease?.sourceUrl).toBe(sourceUrl)
            expect(lease?.rawContentUrl).toBe(rawContentUrl)
            expect(data.contentSha256).toBe(contentSha256)
            expect(data.sourceUrl).toBe(sourceUrl)
            expect(data.rawContentUrl).toBe(rawContentUrl)
            expect(data.installStatus).toBe("not_installed")
            expect(data.persistStatus).toBe("not_persisted")
            expect(data.decision).toBe("lease_for_current_task_only")
          }),
        { config: { skills: { urls: [base] } } },
      )
    }),
  )
})
