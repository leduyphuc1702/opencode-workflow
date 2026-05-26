import path from "path"
import { pathToFileURL } from "url"
import { createHash } from "node:crypto"
import { Effect, Option, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Ripgrep } from "../file/ripgrep"
import { Skill } from "../skill"
import { WorkflowEvidence } from "@/workflow/evidence"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service
    const evidence = yield* Effect.serviceOption(WorkflowEvidence.Service)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* skill
            .require(params.name)
            .pipe(Effect.catchTag("Skill.NotFoundError", (error) => Effect.die(new Error(error.message))))

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const lease = yield* recordRemoteLease(evidence, ctx, info)
          const limit = 10
          const files = yield* rg.files({ cwd: dir, follow: false, hidden: true, signal: ctx.abort }).pipe(
            Stream.filter((file) => !file.includes("SKILL.md")),
            Stream.map((file) => path.resolve(dir, file)),
            Stream.take(limit),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk].map((file) => `<file>${file}</file>`).join("\n")),
          )

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              ...(lease
                ? [
                    `<task_scoped_remote_skill_lease evidence="${lease.evidenceID}" hash="${lease.hash}" />`,
                    "This remote skill is leased only for the current task and is not promoted into the long-lived skill registry.",
                    "",
                  ]
                : []),
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              info.content.trim(),
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files,
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
              ...(lease ? { lease } : {}),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function recordRemoteLease(evidence: Option.Option<WorkflowEvidence.Interface>, ctx: Tool.Context, info: Skill.Info) {
  return Effect.gen(function* () {
    if (info.source !== "remote") return
    if (Option.isNone(evidence)) return
    const hash = createHash("sha256").update(info.content).digest("hex")
    const event = yield* evidence.value
      .append({
        sessionID: ctx.sessionID,
        type: "skill_lease",
        summary: `Task-scoped remote skill lease: ${info.name}`,
        data: {
          name: info.name,
          location: info.location,
          hash,
          decision: "lease_for_current_task_only",
        },
      })
      .pipe(Effect.orElseSucceed(() => undefined))
    if (!event) return
    return { evidenceID: event.id, hash, location: info.location }
  })
}
