import { Effect, Schema } from "effect"
import { History } from "@/history"
import DESCRIPTION from "./history.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query (FTS5/BM25 over the raw conversation trajectory)" }),
  scope: Schema.optional(Schema.Literals(["project", "global"])).annotate({
    description: "project = current project only (default); global = every project",
  }),
  kind: Schema.optional(
    Schema.Literals(["user_text", "assistant_text", "tool_input", "tool_output", "tool_error", "reasoning"]),
  ).annotate({ description: "Filter by part kind" }),
  tool_name: Schema.optional(Schema.String).annotate({ description: "Filter tool parts by tool name (e.g. bash)" }),
  session_id: Schema.optional(Schema.String).annotate({ description: "Filter to a single session id" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max results (default 10)" }),
})

type Metadata = { count: number }

export const HistoryTool = Tool.define<typeof Parameters, Metadata, History.Service>(
  "history",
  Effect.gen(function* () {
    const history = yield* History.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const results = yield* history.search({
            query: args.query,
            scope: args.scope,
            kind: args.kind,
            tool_name: args.tool_name,
            session_id: args.session_id,
            limit: args.limit,
          })
          if (results.length === 0) {
            return {
              title: `History search: 0 results`,
              output: [
                `No conversation parts match "${args.query}".`,
                ``,
                `0 results does NOT mean it never happened. Escalate:`,
                `1. Retry with FEWER / rarer terms (an exact id, function name, error`,
                `   string) — queries are tokenized and AND-joined, so every word must`,
                `   appear. Drop generic words.`,
                `2. Punctuation (URLs, ports, paths) is split into tokens — search one`,
                `   distinctive token, not the full literal.`,
                `3. Widen scope: kind/tool_name/session filters may be too narrow; drop`,
                `   them or set scope:"global".`,
                `4. For curated/summarized knowledge instead of raw turns, use the`,
                `   memory tool.`,
              ].join("\n"),
              metadata: { count: 0 },
            }
          }
          const lines = [
            `Found ${results.length} part${results.length === 1 ? "" : "s"} (BM25-ranked, best first).`,
            `These are VERBATIM conversation fragments — use them for exact recall of`,
            `what was said or done. Snippets are truncated; widen the query if needed.`,
            ``,
          ]
          for (const r of results) {
            lines.push(`### ${r.kind}${r.tool_name ? ` (${r.tool_name})` : ""}`)
            lines.push(`session: ${r.session_id}, message: ${r.message_id}, score: ${r.score.toFixed(3)}`)
            lines.push(r.snippet)
            lines.push("")
          }
          return {
            title: `History search: ${results.length} result${results.length === 1 ? "" : "s"}`,
            output: lines.join("\n"),
            metadata: { count: results.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
