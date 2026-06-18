import { Context, Effect, Layer } from "effect"
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "../session/session.sql"
import type { MessageID } from "../session/schema"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { buildFtsQuery, parseFields } from "./fts-query"
import type { Kind } from "./extract"
import { layer as writerLayer, Service as WriterService } from "./writer"
import { layer as backfillLayer, Service as BackfillService } from "./backfill"

export type SearchHit = {
  part_id: string
  session_id: string
  message_id: string
  project_id: string
  kind: Kind
  tool_name: string | null
  snippet: string
  score: number
  time_created: number
}

export type MessagePart = {
  part_id: string
  type: string
  role: "user" | "assistant"
  tool_name: string | null
  text: string
}

export type MessageContext = {
  message_id: string
  matched: boolean
  time_created: number
  parts: MessagePart[]
}

export interface Interface {
  readonly search: (input: {
    query: string
    scope?: "project" | "global"
    session_id?: string
    kind?: Kind | Kind[]
    tool_name?: string
    time_after?: number
    time_before?: number
    limit?: number
  }) => Effect.Effect<SearchHit[]>

  readonly around: (input: {
    message_id: string
    before?: number
    after?: number
  }) => Effect.Effect<{ session_id: string; messages: MessageContext[] }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/History") {}

const HARD_CAP = 50

type Row = {
  part_id: string
  session_id: string
  message_id: string
  project_id: string
  kind: string
  tool_name: string | null
  snippet: string
  score: number
  time_created: number
}

export const defaultLayer: Layer.Layer<Service | WriterService | BackfillService, never, never> = Layer.suspend(() =>
  Layer.mergeAll(layer, writerLayer, backfillLayer).pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const search = Effect.fn("History.search")(function* (input: Parameters<Interface["search"]>[0]) {
      // Pull inline `field:value` prefixes (kind:/tool:/session:) out of the
      // query; explicit args win, prefixes fill in when the arg is absent.
      // FTS5 needs a MATCH, so at least one non-field term must remain.
      const { fields, rest } = parseFields(input.query, ["kind", "tool", "session"])
      const ftsQuery = buildFtsQuery(rest)
      if (!ftsQuery) return []

      const limit = Math.min(input.limit ?? 10, HARD_CAP)
      // Built as drizzle `sql` fragments + db.all() so this runs on BOTH
      // bun:sqlite (dev/tests) and node:sqlite (packaged desktop). The previous
      // $client.query() path is bun:sqlite-only and throws ("not a function")
      // under node:sqlite's DatabaseSync.
      const conditions: SQL[] = []

      const scope = input.scope ?? "project"
      if (scope === "project") {
        const ctx = yield* InstanceState.context
        conditions.push(sql`history_fts.project_id = ${ctx.project.id}`)
      }

      const sessionId = input.session_id ?? fields.session?.[0]
      if (sessionId) conditions.push(sql`history_fts.session_id = ${sessionId}`)
      const kinds = input.kind ? (Array.isArray(input.kind) ? input.kind : [input.kind]) : fields.kind
      if (kinds && kinds.length > 0) {
        conditions.push(sql`history_fts.kind IN (${sql.join(
          kinds.map((k) => sql`${k}`),
          sql`, `,
        )})`)
      }
      const toolName = input.tool_name ?? fields.tool?.[0]
      if (toolName) conditions.push(sql`history_fts.tool_name = ${toolName}`)
      if (input.time_after !== undefined) conditions.push(sql`history_fts.time_created >= ${input.time_after}`)
      if (input.time_before !== undefined) conditions.push(sql`history_fts.time_created <= ${input.time_before}`)

      const whereExtra = conditions.length > 0 ? sql` AND ${sql.join(conditions, sql` AND `)}` : sql``
      const query = sql`
        SELECT history_fts.part_id, history_fts.session_id, history_fts.message_id,
               history_fts.project_id, history_fts.kind, history_fts.tool_name,
               history_fts.time_created,
               snippet(history_fts_idx, 0, '<<', '>>', '...', 32) AS snippet,
               bm25(history_fts_idx) AS score
        FROM history_fts_idx
        JOIN history_fts ON history_fts.rowid = history_fts_idx.rowid
        WHERE history_fts_idx MATCH ${ftsQuery}
        ${whereExtra}
        ORDER BY score
        LIMIT ${limit}
      `
      const rows = Database.use((db) => db.all(query)) as Row[]
      return rows.map((r) => ({
        part_id: r.part_id,
        session_id: r.session_id,
        message_id: r.message_id,
        project_id: r.project_id,
        kind: r.kind as Kind,
        tool_name: r.tool_name,
        snippet: r.snippet,
        score: -r.score,
        time_created: r.time_created,
      }))
    })

    const around = Effect.fn("History.around")(function* (input: Parameters<Interface["around"]>[0]) {
      const before = input.before ?? 5
      const after = input.after ?? 5
      const anchor = Database.use((db) =>
        db
          .select({
            id: MessageTable.id,
            session_id: MessageTable.session_id,
            time_created: MessageTable.time_created,
          })
          .from(MessageTable)
          .where(eq(MessageTable.id, input.message_id as MessageID))
          .get(),
      )
      if (!anchor) return { session_id: "", messages: [] }

      const beforeRows = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(
            and(
              eq(MessageTable.session_id, anchor.session_id),
              sql`(${MessageTable.time_created} < ${anchor.time_created} OR (${MessageTable.time_created} = ${anchor.time_created} AND ${MessageTable.id} <= ${anchor.id}))`,
            ),
          )
          .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
          .limit(before + 1)
          .all(),
      )
      const afterRows = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(
            and(
              eq(MessageTable.session_id, anchor.session_id),
              sql`(${MessageTable.time_created} > ${anchor.time_created} OR (${MessageTable.time_created} = ${anchor.time_created} AND ${MessageTable.id} > ${anchor.id}))`,
            ),
          )
          .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
          .limit(after)
          .all(),
      )

      const messages = [...beforeRows.reverse(), ...afterRows]
      if (messages.length === 0) return { session_id: anchor.session_id, messages: [] }
      const parts = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(
            and(
              eq(PartTable.session_id, anchor.session_id),
              sql`${PartTable.message_id} IN (${sql.join(
                messages.map((m) => sql`${m.id}`),
                sql`, `,
              )})`,
            ),
          )
          .orderBy(asc(PartTable.message_id), asc(PartTable.id))
          .all(),
      )

      const byMessage = new Map<string, typeof parts>()
      for (const p of parts) {
        const list = byMessage.get(p.message_id) ?? []
        list.push(p)
        byMessage.set(p.message_id, list)
      }

      const out: MessageContext[] = messages.map((m) => {
        const role: "user" | "assistant" =
          (m.data as { role?: "user" | "assistant" })?.role === "user" ? "user" : "assistant"
        const partsHere = (byMessage.get(m.id) ?? []).map((p) => {
          const d = p.data as {
            type: string
            text?: string
            tool?: string
            state?: { input?: unknown; output?: unknown; error?: string }
          }
          const text =
            d.type === "text" || d.type === "reasoning"
              ? (d.text ?? "")
              : d.type === "tool"
                ? `tool: ${d.tool ?? ""}\ninput: ${JSON.stringify(d.state?.input ?? {})}\n${d.state?.error ? `error: ${d.state.error}` : `output: ${JSON.stringify(d.state?.output ?? "")}`}`
                : `[${d.type}]`
          return {
            part_id: p.id,
            type: d.type,
            role,
            tool_name: d.type === "tool" ? (d.tool ?? null) : null,
            text,
          }
        })
        return {
          message_id: m.id,
          matched: m.id === input.message_id,
          time_created: m.time_created,
          parts: partsHere,
        }
      })

      return { session_id: anchor.session_id, messages: out }
    })

    return Service.of({ search, around })
  }),
)
