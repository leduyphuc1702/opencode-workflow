import { Effect, Schema } from "effect"
import DESCRIPTION from "./github_skill_search.txt"
import * as Tool from "./tool"
import { Process } from "@/util/process"
import { which } from "@/util/which"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query for GitHub skills." }),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Maximum number of results to return. Defaults to the GitHub CLI default.",
  }),
  owner: Schema.optional(Schema.String).annotate({
    description: "Optional GitHub user or organization owner to scope the search.",
  }),
})

type RawSkill = {
  description?: unknown
  namespace?: unknown
  path?: unknown
  repo?: unknown
  skillName?: unknown
  stars?: unknown
}

type Result = {
  name: string
  fullName?: string
  description?: string
  url?: string
  stars?: number
}

type Metadata = {
  results: Result[]
  raw?: unknown
}

export function normalizeGithubSkillSearch(raw: unknown): Metadata {
  const entries = Array.isArray(raw) ? raw : []
  return {
    results: entries.flatMap((entry) => {
      if (!isRawSkill(entry)) return []
      const name = string(entry.skillName) ?? string(entry.path)?.split("/").at(-2)
      if (!name) return []
      const repo = string(entry.repo)
      const skillPath = string(entry.path)
      const namespace = string(entry.namespace)
      return [
        {
          name,
          ...(namespace ? { fullName: `${namespace}/${name}` } : repo ? { fullName: `${repo}/${name}` } : {}),
          ...(string(entry.description) ? { description: string(entry.description) } : {}),
          ...(repo && skillPath ? { url: `https://github.com/${repo}/blob/HEAD/${skillPath}` } : {}),
          ...(typeof entry.stars === "number" ? { stars: entry.stars } : {}),
        },
      ]
    }),
    raw,
  }
}

export const GithubSkillSearchTool = Tool.define<typeof Parameters, Metadata, never>(
  "github_skill_search",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "github_skill_search",
          patterns: [params.owner ? `${params.owner}:${params.query}` : params.query],
          always: ["*"],
          metadata: { query: params.query, limit: params.limit, owner: params.owner },
        })

        const raw = yield* runGithubSkillSearch(params)
        const metadata = normalizeGithubSkillSearch(raw)
        return {
          title: `GitHub skills: ${params.query}`,
          metadata,
          output: JSON.stringify(metadata, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)

function runGithubSkillSearch(params: Schema.Schema.Type<typeof Parameters>) {
  return Effect.tryPromise({
    try: async () => {
      const gh = which("gh")
      if (!gh) throw new Error("gh executable not found in PATH")
      const args = [
        "skill",
        "search",
        params.query,
        "--json",
        "description,namespace,path,repo,skillName,stars",
        ...(params.limit ? ["--limit", String(params.limit)] : []),
        ...(params.owner ? ["--owner", params.owner] : []),
      ]
      const result = await Process.run([gh, ...args], { env: spawnEnv(), nothrow: true })
      const stdout = result.stdout.toString()
      const stderr = result.stderr.toString()
      if (result.code !== 0) throw new Error(stderr.trim() || stdout.trim() || `gh ${args.join(" ")} failed`)
      return JSON.parse(stdout || "[]") as unknown
    },
    catch: (error) =>
      new Error(
        error instanceof Error
          ? `gh skill search failed: ${error.message}`
          : `gh skill search failed: ${String(error)}`,
      ),
  })
}

function spawnEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function isRawSkill(value: unknown): value is RawSkill {
  return typeof value === "object" && value !== null
}

function string(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
