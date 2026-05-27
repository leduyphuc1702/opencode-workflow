import path from "path"
import { pathToFileURL } from "url"
import { createHash } from "node:crypto"
import { Effect, Option, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Ripgrep } from "../file/ripgrep"
import { Skill } from "../skill"
import { SessionID } from "@/session/schema"
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
          const source = yield* skill.remoteSource(info.name)
          const lease = yield* recordRemoteLease(evidence, ctx, info, source)
          const skillopt = yield* recordSkillOptProposal(evidence, ctx, info)
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
              ...(skillopt
                ? [
                    `<skillopt_review evidence="${skillopt.evidenceID}" status="proposal" hash="${skillopt.hash}" />`,
                    "SkillOpt review is proposal-only; no skill file will be edited unless the user approves a follow-up implementation.",
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
              ...(skillopt ? { skillopt } : {}),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function recordRemoteLease(
  evidence: Option.Option<WorkflowEvidence.Interface>,
  ctx: Tool.Context,
  info: Skill.Info,
  source: Skill.RemoteSkillSource | undefined,
) {
  return Effect.gen(function* () {
    if (info.source !== "remote") return
    if (Option.isNone(evidence)) return
    const rawContent = yield* Effect.tryPromise(() => Bun.file(info.location).text()).pipe(
      Effect.orElseSucceed(() => info.content),
    )
    const contentSha256 = createHash("sha256").update(rawContent).digest("hex")
    const event = yield* evidence.value
      .append({
        sessionID: workflowSessionID(ctx),
        type: "skill_lease",
        summary: `Task-scoped remote skill lease: ${info.name}`,
        data: {
          name: info.name,
          sourceUrl: source?.sourceUrl ?? "unknown",
          rawContentUrl: source?.rawContentUrl ?? "unknown",
          location: info.location,
          contentSha256,
          hash: contentSha256,
          decision: "lease_for_current_task_only",
          installStatus: "not_installed",
          persistStatus: "not_persisted",
          callingAgent: ctx.agent,
          childSessionID: ctx.sessionID,
          rationale: "Remote skill content is loaded for this task only and is not installed or promoted.",
        },
      })
      .pipe(Effect.orElseSucceed(() => undefined))
    if (!event) return
    return {
      evidenceID: event.id,
      hash: contentSha256,
      contentSha256,
      location: info.location,
      sourceUrl: source?.sourceUrl ?? "unknown",
      rawContentUrl: source?.rawContentUrl ?? "unknown",
    }
  })
}

function recordSkillOptProposal(evidence: Option.Option<WorkflowEvidence.Interface>, ctx: Tool.Context, info: Skill.Info) {
  return Effect.gen(function* () {
    if (Option.isNone(evidence)) return
    const rawContent = yield* skillContent(info)
    const originalHash = createHash("sha256").update(rawContent).digest("hex")
    const candidates = skillOptCandidates()
    const selectedCandidate = candidates.toSorted((a, b) => b.score - a.score)[0]
    const event = yield* evidence.value
      .append({
        sessionID: workflowSessionID(ctx),
        type: "skillopt_proposal",
        summary: `SkillOpt proposal queued: ${info.name}`,
        data: {
          skillName: info.name,
          skillPath: info.location,
          originalHash,
          source: info.source ?? "local",
          userRequest: lastUserRequest(ctx.messages),
          trajectory: {
            agent: ctx.agent,
            childSessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: ctx.callID,
            loadedSkill: info.name,
          },
          candidates,
          selectedCandidate,
          validation: {
            baselineScore: 1,
            candidateScore: selectedCandidate?.score ?? 0,
            requiredScore: 1.2,
            passed: false,
            reason: "Independent replay validation has not exceeded the original skill by 20% yet.",
          },
          status: "proposal",
          applyablePatch: false,
        },
      })
      .pipe(Effect.orElseSucceed(() => undefined))
    if (!event) return
    return {
      evidenceID: event.id,
      hash: originalHash,
      originalHash,
      applyablePatch: false,
      source: info.source ?? "local",
    }
  })
}

function skillContent(info: Skill.Info) {
  return Effect.tryPromise(() => Bun.file(info.location).text()).pipe(Effect.orElseSucceed(() => info.content))
}

function skillOptCandidates() {
  return [
    {
      id: "add-codebase-signals",
      kind: "add",
      title: "Add codebase-specific signals observed during this skill usage",
      rationale: "Capture concrete paths, commands, verification signals, and failure modes from the latest trajectory.",
      score: 1,
      applyablePatch: false,
    },
    {
      id: "edit-ambiguous-steps",
      kind: "edit",
      title: "Tighten ambiguous instructions that caused extra exploration",
      rationale: "Rewrite broad guidance into explicit decision points and stop conditions for similar tasks.",
      score: 0.95,
      applyablePatch: false,
    },
    {
      id: "replace-stale-reference",
      kind: "replace",
      title: "Replace stale or generic references with verified project-local references",
      rationale: "Prefer evidence from the current codebase over generic examples when the skill is reused here.",
      score: 0.9,
      applyablePatch: false,
    },
  ]
}

function workflowSessionID(ctx: Tool.Context) {
  const value = ctx.extra?.workflowSessionID
  return typeof value === "string" ? SessionID.make(value) : ctx.sessionID
}

function lastUserRequest(messages: Tool.Context["messages"]) {
  return messages
    .toReversed()
    .find((message) => message.info.role === "user")
    ?.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()
    .slice(0, 4000)
}
