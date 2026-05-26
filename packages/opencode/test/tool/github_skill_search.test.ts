import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { chmod } from "fs/promises"
import path from "path"
import type { Permission } from "@/permission"
import type { Tool } from "@/tool/tool"
import { Agent } from "@/agent/agent"
import { GithubSkillSearchTool, normalizeGithubSkillSearch } from "@/tool/github_skill_search"
import { MessageID, SessionID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "scout",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer))

const init = Effect.fn("GithubSkillSearchToolTest.init")(function* () {
  const info = yield* GithubSkillSearchTool
  return yield* info.init()
})

function withPath<A, E, R>(nextPath: string, self: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => process.env.PATH),
    () =>
      Effect.gen(function* () {
        process.env.PATH = nextPath
        return yield* self
      }),
    (previous) =>
      Effect.sync(() => {
        if (previous) process.env.PATH = previous
        else delete process.env.PATH
      }),
  )
}

function withEnv<A, E, R>(key: string, value: string, self: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => process.env[key]),
    () =>
      Effect.gen(function* () {
        process.env[key] = value
        return yield* self
      }),
    (previous) =>
      Effect.sync(() => {
        if (previous) process.env[key] = previous
        else delete process.env[key]
      }),
  )
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.github_skill_search", () => {
  test("normalizes gh skill search JSON", () => {
    expect(
      normalizeGithubSkillSearch([
        {
          skillName: "research",
          namespace: "nous/research",
          path: "optional-skills/research/SKILL.md",
          repo: "NousResearch/hermes-agent",
          description: "Research skill",
          stars: 42,
        },
      ]),
    ).toEqual({
      results: [
        {
          name: "research",
          fullName: "nous/research/research",
          description: "Research skill",
          url: "https://github.com/NousResearch/hermes-agent/blob/HEAD/optional-skills/research/SKILL.md",
          stars: 42,
        },
      ],
      raw: [
        {
          skillName: "research",
          namespace: "nous/research",
          path: "optional-skills/research/SKILL.md",
          repo: "NousResearch/hermes-agent",
          description: "Research skill",
          stars: 42,
        },
      ],
    })
  })

  it.live("executes gh skill search with JSON, owner, and limit", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const argsFile = path.join(dir, "args.txt")
        const gh = path.join(dir, "gh")
        yield* Effect.promise(() =>
          Bun.write(
            gh,
            [
              "#!/bin/sh",
              'printf "%s\\n" "$@" > "$GH_ARGS_FILE"',
              'printf "%s\\n" \'[{"skillName":"deploy","namespace":"ops","path":"skills/deploy/SKILL.md","repo":"owner/repo","description":"Deploy skill","stars":7}]\'',
              "",
            ].join("\n"),
          ),
        )
        yield* Effect.promise(() => chmod(gh, 0o755))

        const tool = yield* init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const result = yield* withEnv(
          "GH_ARGS_FILE",
          argsFile,
          withPath(
            dir,
            tool.execute(
              { query: "deploy", limit: 3, owner: "owner" },
              {
                ...ctx,
                ask: (req) =>
                  Effect.sync(() => {
                    requests.push(req)
                  }),
              },
            ),
          ),
        )

        expect(requests[0].permission).toBe("github_skill_search")
        expect(result.metadata.results[0]).toMatchObject({
          name: "deploy",
          fullName: "ops/deploy",
          stars: 7,
        })
        expect(yield* Effect.promise(() => Bun.file(argsFile).text())).toContain("--limit\n3")
        expect(yield* Effect.promise(() => Bun.file(argsFile).text())).toContain("--owner\nowner")
      }),
    ),
  )

  it.live("fails clearly when gh is missing", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* init()
        const result = yield* withPath(
          dir,
          tool.execute({ query: "deploy" }, { ...ctx, ask: () => Effect.void }),
        ).pipe(Effect.exit)

        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const error = Cause.squash(result.cause)
          expect(error instanceof Error ? error.message : String(error)).toContain("gh skill search failed")
        }
      }),
    ),
  )
})
