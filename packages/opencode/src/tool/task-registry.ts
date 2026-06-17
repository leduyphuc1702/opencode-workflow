import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./task-registry.txt"
import { TaskRegistry } from "@/task/registry"
import type { SessionID } from "../session/schema"

// Renamed from MiMo's `task` tool to avoid colliding with opencode-workflow's
// existing subagent-spawning `task` tool. Shell-mode (parse/recover) is dropped
// because the target Tool.Def has no `shell` field — JSON operations only.

const id = "task_registry"

const sessionField = Schema.optional(Schema.String).annotate({
  description: "Session id to act on. Defaults to current session.",
})
const idField = Schema.String.annotate({ description: "Task id, e.g. T1 or T1.1." })

const CreateOp = Schema.Struct({
  action: Schema.Literal("create"),
  summary: Schema.String.annotate({ description: "Task summary for a single task." }),
  parent_id: Schema.optional(Schema.String).annotate({ description: "Parent task id for sub-tasks." }),
  session_id: sessionField,
})
const ListOp = Schema.Struct({
  action: Schema.Literal("list"),
  status: Schema.optional(Schema.Literals(["open", "in_progress", "blocked", "done", "abandoned"])).annotate({
    description: "Filter by status.",
  }),
  include_terminal: Schema.optional(Schema.Boolean).annotate({
    description: "Include done/abandoned tasks. Default false.",
  }),
  include_archived: Schema.optional(Schema.Boolean).annotate({
    description: "Include archived tasks. Default false.",
  }),
  session_id: sessionField,
})
const GetOp = Schema.Struct({ action: Schema.Literal("get"), id: idField, session_id: sessionField })
const StartOp = Schema.Struct({
  action: Schema.Literal("start"),
  id: idField,
  event_summary: Schema.optional(Schema.String).annotate({ description: "Short note on starting." }),
  session_id: sessionField,
})
const BlockOp = Schema.Struct({
  action: Schema.Literal("block"),
  id: idField,
  event_summary: Schema.optional(Schema.String).annotate({ description: "Short reason for blocking." }),
  session_id: sessionField,
})
const UnblockOp = Schema.Struct({
  action: Schema.Literal("unblock"),
  id: idField,
  event_summary: Schema.optional(Schema.String).annotate({ description: "Short reason for unblocking." }),
  session_id: sessionField,
})
const DoneOp = Schema.Struct({
  action: Schema.Literal("done"),
  id: idField,
  event_summary: Schema.optional(Schema.String).annotate({ description: "Short summary of what was completed." }),
  session_id: sessionField,
})
const AbandonOp = Schema.Struct({
  action: Schema.Literal("abandon"),
  id: idField,
  event_summary: Schema.optional(Schema.String).annotate({ description: "Short reason for abandoning." }),
  session_id: sessionField,
})
const RenameOp = Schema.Struct({
  action: Schema.Literal("rename"),
  id: idField,
  summary: Schema.String.annotate({ description: "New task summary." }),
  session_id: sessionField,
})

export const Parameters = Schema.Struct({
  operation: Schema.Union([
    CreateOp,
    ListOp,
    GetOp,
    StartOp,
    BlockOp,
    UnblockOp,
    DoneOp,
    AbandonOp,
    RenameOp,
  ]).annotate({ discriminator: "action", description: "The task operation to perform." }),
})

type Metadata = {
  id?: string
  status?: string
  ids?: string[]
  count?: number
}

export const TaskRegistryTool = Tool.define<typeof Parameters, Metadata, TaskRegistry.Service>(
  id,
  Effect.gen(function* () {
    const reg = yield* TaskRegistry.Service

    const run = Effect.fn("TaskRegistryTool.execute")(function* (
      input: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const op = input.operation
      const sessionID = (op.session_id || ctx.sessionID) as SessionID
      const owner = ctx.agent

      switch (op.action) {
        case "create": {
          const t = yield* reg.create({
            session_id: sessionID,
            summary: op.summary,
            parent_id: op.parent_id || undefined,
            owner,
          })
          return {
            title: `Task created: ${t.id}`,
            output: `Created ${t.id} (${t.status}): ${t.summary}`,
            metadata: { id: t.id, status: t.status } as Metadata,
          }
        }
        case "list": {
          const tasks = yield* reg.list({
            session_id: sessionID,
            status: op.status,
            include_terminal: op.include_terminal,
            include_archived: op.include_archived,
          })
          const lines = tasks.length === 0 ? ["No tasks."] : tasks.map((t) => `${t.id} ${t.status} — ${t.summary}`)
          return {
            title: `Tasks: ${tasks.length}`,
            output: lines.join("\n"),
            metadata: { count: tasks.length, ids: tasks.map((t) => t.id) } as Metadata,
          }
        }
        case "get": {
          const t = yield* reg.get({ session_id: sessionID, id: op.id })
          if (!t)
            return {
              title: `Task ${op.id}: not found`,
              output: `No task ${op.id}. Use task_registry list to see valid task IDs.`,
              metadata: {} as Metadata,
            }
          return {
            title: `Task ${op.id}: ${t.status}`,
            output: JSON.stringify(t, null, 2),
            metadata: { id: t.id, status: t.status } as Metadata,
          }
        }
        case "start": {
          const result = yield* reg.start({ session_id: sessionID, id: op.id, owner, event_summary: op.event_summary })
          return {
            title: `Task ${op.id}: ${result.status}`,
            output: `start → ${result.status}`,
            metadata: { id: result.id, status: result.status } as Metadata,
          }
        }
        case "block": {
          const result = yield* reg.block({ session_id: sessionID, id: op.id, event_summary: op.event_summary })
          return {
            title: `Task ${op.id}: blocked`,
            output: `block → ${result.status}`,
            metadata: { id: result.id, status: result.status } as Metadata,
          }
        }
        case "unblock": {
          const result = yield* reg.unblock({ session_id: sessionID, id: op.id, event_summary: op.event_summary })
          return {
            title: `Task ${op.id}: ${result.status}`,
            output: `unblock → ${result.status}`,
            metadata: { id: result.id, status: result.status } as Metadata,
          }
        }
        case "done": {
          const result = yield* reg.done({ session_id: sessionID, id: op.id, event_summary: op.event_summary })
          return {
            title: `Task ${op.id}: done`,
            output: `done → ${result.status}`,
            metadata: { id: result.id, status: result.status } as Metadata,
          }
        }
        case "abandon": {
          const result = yield* reg.abandon({ session_id: sessionID, id: op.id, event_summary: op.event_summary })
          return {
            title: `Task ${op.id}: abandoned`,
            output: `abandon → ${result.status}`,
            metadata: { id: result.id, status: result.status } as Metadata,
          }
        }
        case "rename": {
          const result = yield* reg.rename({ session_id: sessionID, id: op.id, summary: op.summary })
          return {
            title: `Task ${op.id}: renamed`,
            output: `rename → "${result.summary}"`,
            metadata: { id: result.id, status: result.status } as Metadata,
          }
        }
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) => run(args, ctx).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
