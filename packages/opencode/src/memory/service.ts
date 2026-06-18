import { Context, Effect, Layer } from "effect"
import path from "path"
import os from "os"
import { Global } from "@opencode-ai/core/global"
import { Database } from "@/storage/db"
import { Config } from "@/config/config"
import { reconcileMemory } from "./reconcile"
import { buildFtsQuery, parseFields } from "./fts-query"

// Type-weighted ranking: nudge curated, hand-authored memory above machine-
// generated session state at comparable BM25. Faithful in spirit to vibervn-
// context-engine's "downrank generated, surface hand-written" (no generated
// CODE files here — the memory corpus is markdown, so the authorship signal
// lives in `type`). Conservative multiplier; never excludes (the score floor +
// always-keep-#1 still apply). Unknown types default to 1.0.
const TYPE_WEIGHTS: Record<string, number> = {
  // curated / hand-authored
  memory: 1.0,
  notes: 1.0,
  free: 1.0,
  // cc curated categories
  feedback: 1.0,
  project: 1.0,
  reference: 1.0,
  user: 1.0,
  // machine-generated session state
  checkpoint: 0.85,
  progress: 0.85,
}

type SearchRow = {
  path: string
  scope: string
  scope_id: string
  type: string
  snippet: string
  score: number
}

export interface Interface {
  readonly root: () => Effect.Effect<string>
  readonly reconcile: () => Effect.Effect<{ indexed: number; pruned: number }>
  readonly search: (input: {
    query: string
    scope?: string
    scope_id?: string
    type?: string
    limit?: number
  }) => Effect.Effect<
    Array<{ path: string; snippet: string; score: number; scope: string; scope_id: string; type: string }>
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

export const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const root = path.join(Global.Path.data, "memory")
    const ccBase = path.join(os.homedir(), ".claude", "projects")

    const rootEff = Effect.fn("Memory.root")(function* () {
      return root
    })

    const reconcile = Effect.fn("Memory.reconcile")(function* () {
      const cfg = yield* config.get()
      const cc = cfg.memory?.cc_index ? ccBase : undefined
      return yield* Effect.promise(() => reconcileMemory({ mimo: root, cc }))
    })

    const search = Effect.fn("Memory.search")(function* (input: {
      query: string
      scope?: string
      scope_id?: string
      type?: string
      limit?: number
    }) {
      // Lazy reconcile before search (covers off-tool writes); honour config flag.
      const cfg = yield* config.get()
      if (cfg.checkpoint?.memory_reconcile_on_search ?? true) {
        const cc = cfg.memory?.cc_index ? ccBase : undefined
        yield* Effect.promise(() => reconcileMemory({ mimo: root, cc }))
      }

      const limit = input.limit ?? 10
      // Pull inline `field:value` prefixes (type:/scope:/scope_id:/path:) out of
      // the query, then build the FTS5 MATCH from the remaining free terms.
      // FTS5 needs a MATCH expression, so at least one non-field term is
      // required — a query of only field prefixes returns [] (use Glob/Read to
      // browse). See packages/opencode/src/memory/fts-query.ts for rationale.
      const { fields, rest } = parseFields(input.query, ["type", "scope", "scope_id", "path"])
      const ftsQuery = buildFtsQuery(rest)
      if (!ftsQuery) return []

      // OR-join means a doc matching only a common word still matches, but BM25
      // ranks it far below a doc matching several rare query words. Drop common-
      // word noise with a RELATIVE floor: keep results scoring at least `ratio`
      // of the top hit. Relative because BM25 magnitudes are corpus-size-
      // dependent. The #1 result is ALWAYS kept. Default 0.15; 0 disables.
      const floorRatio = cfg.checkpoint?.memory_search_score_floor ?? 0.15

      // Construct WHERE clauses for scope/scope_id/type/path filtering.
      // Explicit args win; inline field prefixes fill in when the arg is absent.
      const conditions: string[] = []
      const params: string[] = []
      const scope = input.scope ?? fields.scope?.[0]
      if (scope) {
        conditions.push("memory_fts.scope = ?")
        params.push(scope)
      }
      const scopeId = input.scope_id ?? fields.scope_id?.[0]
      if (scopeId) {
        conditions.push("memory_fts.scope_id = ?")
        params.push(scopeId)
      }
      const type = input.type ?? fields.type?.[0]
      if (type) {
        conditions.push("memory_fts.type = ?")
        params.push(type)
      }
      // path: substring filter (only from inline prefix; no dedicated arg).
      for (const p of fields.path ?? []) {
        conditions.push("memory_fts.path LIKE ?")
        params.push(`%${p}%`)
      }
      const whereClause = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : ""

      const sql = `
        SELECT memory_fts.path, memory_fts.scope, memory_fts.scope_id, memory_fts.type,
               snippet(memory_fts_idx, 0, '<<', '>>', '...', 32) AS snippet,
               bm25(memory_fts_idx) AS score
        FROM memory_fts_idx
        JOIN memory_fts ON memory_fts.id = memory_fts_idx.rowid
        WHERE memory_fts_idx MATCH ?
        ${whereClause}
        ORDER BY score
        LIMIT ?
      `

      // Over-fetch (3x, capped) so the relative floor can trim common-word
      // noise without starving the list when there ARE enough real hits.
      const fetchLimit = Math.min(limit * 3, 50)
      const rows = Database.Client().$client.query(sql).all(ftsQuery, ...params, fetchLimit) as SearchRow[]

      // FTS5 bm25() returns lower = better; convert to higher = better, then
      // apply the type weight (curated > machine-generated). Re-sort by the
      // weighted score because the weighting can reorder same-BM25 ties.
      const mapped = rows
        .map((r) => ({
          path: r.path,
          snippet: r.snippet,
          score: -r.score * (TYPE_WEIGHTS[r.type] ?? 1),
          scope: r.scope,
          scope_id: r.scope_id,
          type: r.type,
        }))
        .sort((a, b) => b.score - a.score)
      if (mapped.length === 0) return []
      const topScore = mapped[0].score
      const cutoff = floorRatio > 0 ? topScore * floorRatio : -Infinity
      return mapped.filter((r, i) => i === 0 || r.score >= cutoff).slice(0, limit)
    })

    return Service.of({
      root: rootEff,
      reconcile,
      search,
    })
  }),
)

export const defaultLayer = Layer.suspend(() => layer.pipe(Layer.provide(Config.defaultLayer)))
