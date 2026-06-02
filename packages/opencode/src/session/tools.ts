import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Config } from "@/config/config"
import { ConfigSecurity } from "@/config/security"
import { SecurityMode } from "@/security/mode"
import { SecurityScanner } from "@/security/scanner"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { ModelID } from "@/provider/schema"
import { Plugin } from "@/plugin"
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Effect, Option } from "effect"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import * as Log from "@opencode-ai/core/util/log"
import { EffectBridge } from "@/effect/bridge"
import { WorkflowRuntime } from "@/workflow/runtime"

const log = Log.create({ service: "session.tools" })

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
  promptOps: TaskPromptOps
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service
  const config = yield* Effect.serviceOption(Config.Service)
  const workflow = yield* Effect.serviceOption(WorkflowRuntime.Service)

  const beforeWorkflowTool = (input: WorkflowRuntime.BeforeToolInput): Effect.Effect<{ warning?: string }> =>
    Option.isSome(workflow) ? workflow.value.beforeTool(input).pipe(Effect.orDie) : Effect.succeed({ warning: undefined })

  const beforeSecurityTool = (tool: string, args: Record<string, unknown>) =>
    Effect.gen(function* () {
      if (Option.isNone(config)) return { warning: undefined, blocking: [] as SecurityScanner.Finding[] }
      const security = (yield* config.value.get()).security
      if (!ConfigSecurity.enabled(security)) return { warning: undefined, blocking: [] as SecurityScanner.Finding[] }
      const target = securityScanTarget(tool, args)
      if (!target) return { warning: undefined, blocking: [] as SecurityScanner.Finding[] }
      const findings = SecurityScanner.scan(target)
      const warning = securityWarning(findings)
      const blocking = ConfigSecurity.mode(security) === "strict" ? findings.filter((item) => !item.advisory) : []
      return { warning, blocking }
    })

  const securityPriorityRuleset = () =>
    Effect.gen(function* () {
      if (Option.isNone(config)) return [] as Permission.Ruleset
      const security = (yield* config.value.get()).security
      if (!ConfigSecurity.enabled(security)) return [] as Permission.Ruleset
      return SecurityMode.deriveRules(ConfigSecurity.permissionMode(security), {
        cwd: input.session.directory,
        protectedPaths: ConfigSecurity.protectedPaths(security),
        additionalDirectories: ConfigSecurity.additionalDirectories(security),
      })
    })

  const context = (args: Record<string, unknown>, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      promptOps: input.promptOps,
      workflowSessionID: input.session.parentID ?? input.session.id,
    },
    agent: input.agent.name,
    messages: input.messages,
    metadata: (val) =>
      input.processor.updateToolCall(options.toolCallId, (match) => {
        if (!["running", "pending"].includes(match.state.status)) return match
        return {
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: { start: Date.now() },
          },
        }
      }),
    ask: (req) =>
      Effect.gen(function* () {
        const priority = yield* securityPriorityRuleset()
        yield* permission.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
          priority,
        })
      }).pipe(Effect.orDie),
  })

  const securityWarning = (findings: SecurityScanner.Finding[]) => {
    if (findings.length === 0) return undefined
    return findings.map((finding) => `${finding.level} ${finding.pattern} at line ${finding.line}`).join("\n")
  }

  const securityScanTarget = (tool: string, args: Record<string, unknown>) => {
    if (tool === "write" && typeof args.filePath === "string" && typeof args.content === "string") {
      return { path: args.filePath, content: args.content }
    }
    if (tool === "edit" && typeof args.filePath === "string" && typeof args.newString === "string") {
      return { path: args.filePath, content: args.newString }
    }
    // apply_patch is a first-class mutating tool; scan its patch text so added
    // content is checked like write/edit. Path attribution is coarse (the patch
    // may touch several files) but secret/dangerous-pattern detection applies.
    if (tool === "apply_patch" && typeof args.patchText === "string") {
      return { path: "apply_patch", content: args.patchText }
    }
  }

  for (const item of yield* registry.tools({
    modelID: ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            const securityGuard = yield* beforeSecurityTool(item.id, args)
            if (securityGuard.warning) yield* ctx.metadata({ metadata: { security: securityGuard.warning } })
            if (securityGuard.blocking.length > 0) return yield* new Permission.DeniedError({ ruleset: securityGuard.blocking })

            const workflowGuard = yield* beforeWorkflowTool({
              workflowSessionID: input.session.parentID ?? input.session.id,
              currentSessionID: input.session.id,
              agent: input.agent.name,
              tool: item.id,
              args,
            })
            const result = yield* item.execute(args, ctx)
            const warnings = [
              securityGuard.warning ? `[Security warning]\n${securityGuard.warning}` : undefined,
              workflowGuard.warning ? `[Workflow warning] ${workflowGuard.warning}` : undefined,
            ].filter((item): item is string => Boolean(item))
            const output = {
              ...result,
              output: warnings.length > 0 ? `${warnings.join("\n\n")}\n\n${result.output}` : result.output,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
  }

  for (const [key, item] of Object.entries(yield* mcp.tools())) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, schema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          const ctx = context(args, opts)
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args },
          )
          yield* beforeWorkflowTool({
            workflowSessionID: input.session.parentID ?? input.session.id,
            currentSessionID: input.session.id,
            agent: input.agent.name,
            tool: key,
            args,
          })
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
            yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
            return yield* Effect.promise(() => execute(args, opts))
          }).pipe(
            Effect.withSpan("Tool.execute", {
              attributes: {
                "tool.name": key,
                "tool.call_id": opts.toolCallId,
                "session.id": ctx.sessionID,
                "message.id": input.processor.message.id,
              },
            }),
          )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                attachments.push({
                  type: "file",
                  mime: resource.mimeType ?? "application/octet-stream",
                  url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          if (opts.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(opts.toolCallId, output)
          }
          return output
        }),
      )
    tools[key] = item
  }

  return tools
})

export * as SessionTools from "./tools"
