import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "@/permission"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { extractComposeBundle } from "./compose/extract"
import { Glob } from "@opencode-ai/core/util/glob"
import * as Log from "@opencode-ai/core/util/log"
import { Discovery } from "./discovery"
import CUSTOMIZE_OPENCODE_SKILL_BODY from "./prompt/customize-opencode.md" with { type: "text" }
import OPENCODE_WORKFLOW_SKILL_BODY from "./prompt/opencode-workflow.md" with { type: "text" }
import DESIGN_TASTE_FRONTEND_SKILL_BODY from "./prompt/taste-skill.md" with { type: "text" }
import { isRecord } from "@/util/record"

const log = Log.create({ service: "skill" })
const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_SKILL_PATTERN = "skills/**/SKILL.md"
const OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"
const SKILL_PATTERN = "**/SKILL.md"

// Built-in skill that ships with opencode. The model's intuition for what an
// opencode.json should look like is often wrong, and opencode hard-fails on
// invalid config, so users hit cryptic startup errors. Loading this skill
// when the model is asked to touch opencode's own config files gives it the
// actual schemas instead of guesses.
const CUSTOMIZE_OPENCODE_SKILL_NAME = "customize-opencode"
const CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION =
  "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself."
const OPENCODE_WORKFLOW_SKILL_NAME = "opencode-workflow"
const OPENCODE_WORKFLOW_SKILL_DESCRIPTION =
  "Use when running the bundled opencode-workflow orchestrator: CodeGraph-first codebase understanding, design-before-implementation approval gates, task-scoped remote skills, and sub-agent break/resume."
// Vendored from github.com/Leonxlnx/taste-skill at commit
// 3c7017d636c3a4aad378433ea6d0cfa6c921da4a under the MIT License,
// Copyright (c) 2026 Leonxlnx.
const DESIGN_TASTE_FRONTEND_SKILL_NAME = "design-taste-frontend"
const DESIGN_TASTE_FRONTEND_SKILL_DESCRIPTION =
  "Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right design direction, and ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check."

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
  content: Schema.String,
  source: Schema.optional(Schema.Literals(["built-in", "local", "remote"])),
  // Hidden skills (e.g. the compose bundle) are loadable by name but excluded
  // from the available-skills listing offered to normal agents.
  hidden: Schema.optional(Schema.Boolean),
})
export type Info = Schema.Schema.Type<typeof Info>

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

function isSkillFrontmatter(data: unknown): data is { name: string; description?: string } {
  return (
    isRecord(data) &&
    typeof data.name === "string" &&
    (data.description === undefined || typeof data.description === "string")
  )
}

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("SkillInvalidError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Issue)),
}) {}

export class NameMismatchError extends Schema.TaggedErrorClass<NameMismatchError>()("SkillNameMismatchError", {
  path: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Skill.NotFoundError", {
  name: Schema.String,
  available: Schema.Array(Schema.String),
}) {
  override get message() {
    return `Skill "${this.name}" not found. Available skills: ${this.available.join(", ") || "none"}`
  }
}

type State = {
  skills: Record<string, Info>
  dirs: Set<string>
  remoteSources: Record<string, RemoteSkillSource>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
  remoteDirs: string[]
  remoteSources: Record<string, RemoteSkillSource>
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
  remoteDirs: Set<string>
  remoteSources: Record<string, RemoteSkillSource>
}

export type RemoteSkillSource = Pick<Discovery.PulledSkill, "sourceUrl" | "rawContentUrl">

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly require: (name: string) => Effect.Effect<Info, NotFoundError>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  readonly remoteSource: (name: string) => Effect.Effect<RemoteSkillSource | undefined>
}

const add = Effect.fnUntraced(function* (
  state: State,
  match: string,
  bus: Bus.Interface,
  source: Info["source"],
  sourceInfo?: RemoteSkillSource,
) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.parse(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) return

  if (state.skills[md.data.name]) {
    log.warn("duplicate skill name", {
      name: md.data.name,
      existing: state.skills[md.data.name].location,
      duplicate: match,
    })
  }

  state.dirs.add(path.dirname(match))
  state.skills[md.data.name] = {
    name: md.data.name,
    description: md.data.description,
    location: match,
    content: md.content,
    source,
    hidden: isRecord(md.data) && (md.data as { hidden?: unknown }).hidden === true ? true : undefined,
  }
  if (sourceInfo) {
    state.remoteSources[md.data.name] = sourceInfo
    return
  }
  delete state.remoteSources[md.data.name]
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      return Effect.succeed([] as string[])
    }),
  )

  for (const match of matches) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: AppFileSystem.Interface,
  global: Global.Interface,
  disableExternalSkills: boolean,
  disableClaudeCodeSkills: boolean,
  directory: string,
  worktree: string,
  disableComposeSkills: boolean,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set(), remoteDirs: new Set(), remoteSources: {} }

  // Extract the bundled compose skills to disk first so a user-disk skill with
  // the same name can override them. They carry `hidden: true` frontmatter, so
  // they stay loadable by name but out of the normal available-skills listing.
  // Dynamically imported (like the Session import in add()) so the compose
  // module's type graph does not bloat this file's static type-checking.
  if (!disableComposeSkills) {
    const composeRoot = yield* Effect.promise(() => extractComposeBundle()).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    )
    if (composeRoot && (yield* fsys.isDir(composeRoot))) {
      yield* scan(state, composeRoot, SKILL_PATTERN, { scope: "compose" })
    }
  }

  const externalDirs: string[] = []
  if (!disableExternalSkills) {
    if (!disableClaudeCodeSkills) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  const configDirs = yield* config.directories()
  for (const dir of configDirs) {
    yield* scan(state, dir, OPENCODE_SKILL_PATTERN)
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      log.warn("skill path not found", { path: dir })
      continue
    }

    yield* scan(state, dir, SKILL_PATTERN)
  }

  for (const url of cfg.skills?.urls ?? []) {
    const pulledDirs = yield* discovery.pull(url)
    for (const skill of pulledDirs) {
      state.remoteDirs.add(skill.dir)
      state.remoteSources[skill.dir] = { sourceUrl: skill.sourceUrl, rawContentUrl: skill.rawContentUrl }
      yield* scan(state, skill.dir, SKILL_PATTERN)
    }
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
    remoteDirs: Array.from(state.remoteDirs),
    remoteSources: state.remoteSources,
  }
})

const loadSkills = Effect.fnUntraced(function* (state: State, discovered: DiscoveryState, bus: Bus.Interface) {
  yield* Effect.forEach(
    discovered.matches,
    (match) => add(state, match, bus, remoteSource(discovered, match), remoteSkillSource(discovered, match)),
    {
      concurrency: "unbounded",
      discard: true,
    },
  )

  log.info("init", { count: Object.keys(state.skills).length })
})

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const fsys = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const flags = yield* RuntimeFlags.Service
    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(
          config,
          discovery,
          fsys,
          global,
          flags.disableExternalSkills,
          flags.disableClaudeCodeSkills,
          ctx.directory,
          ctx.worktree,
          flags.disableComposeSkills,
        )
      }),
    )
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const s: State = { skills: {}, dirs: new Set(), remoteSources: {} }
        // Register the built-in skill BEFORE disk discovery so a user-disk
        // skill with the same name can override it.
        s.skills[CUSTOMIZE_OPENCODE_SKILL_NAME] = {
          name: CUSTOMIZE_OPENCODE_SKILL_NAME,
          description: CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION,
          location: "<built-in>",
          content: CUSTOMIZE_OPENCODE_SKILL_BODY,
          source: "built-in",
        }
        s.skills[OPENCODE_WORKFLOW_SKILL_NAME] = {
          name: OPENCODE_WORKFLOW_SKILL_NAME,
          description: OPENCODE_WORKFLOW_SKILL_DESCRIPTION,
          location: "<built-in>",
          content: OPENCODE_WORKFLOW_SKILL_BODY,
          source: "built-in",
        }
        s.skills[DESIGN_TASTE_FRONTEND_SKILL_NAME] = {
          name: DESIGN_TASTE_FRONTEND_SKILL_NAME,
          description: DESIGN_TASTE_FRONTEND_SKILL_DESCRIPTION,
          location: "<built-in>",
          content: DESIGN_TASTE_FRONTEND_SKILL_BODY,
          source: "built-in",
        }
        yield* loadSkills(s, yield* InstanceState.get(discovered), bus)
        return s
      }),
    )

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.skills[name]
    })

    const require = Effect.fn("Skill.require")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const info = s.skills[name]
      if (info) return info
      return yield* new NotFoundError({ name, available: Object.keys(s.skills).toSorted() })
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      return (yield* InstanceState.get(discovered)).dirs
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      const list = Object.values(s.skills)
        .filter((skill) => skill.source !== "remote" && !skill.hidden)
        .toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    const remoteSource = Effect.fn("Skill.remoteSource")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.remoteSources[name]
    })

    return Service.of({ get, require, all, dirs, available, remoteSource })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export function fmt(list: Info[], opts: { verbose: boolean }) {
  const described = list.filter((skill) => skill.description !== undefined)
  if (described.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...described
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${skill.description}</description>`,
          `    <location>${pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n")
}

function remoteSource(discovered: DiscoveryState, match: string): Info["source"] {
  return remoteSkillDir(discovered, match) ? "remote" : "local"
}

function remoteSkillSource(discovered: DiscoveryState, match: string) {
  const dir = remoteSkillDir(discovered, match)
  if (!dir) return undefined
  return discovered.remoteSources[dir]
}

function remoteSkillDir(discovered: DiscoveryState, match: string) {
  return discovered.remoteDirs.find((dir) => match === path.join(dir, "SKILL.md") || match.startsWith(dir + path.sep))
}

export * as Skill from "."
