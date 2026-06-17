import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Database } from "@/storage/db"
import { MessageV2 } from "@/session/message-v2"
import type { PartID, SessionID, MessageID } from "@/session/schema"
import { History } from "@/history"
import { layer as writerLayer, Service as WriterService } from "@/history/writer"
import { layer as backfillLayer } from "@/history/backfill"
import { HistoryFtsTable } from "@/history/fts.sql"
import { buildFtsQuery } from "@/history/fts-query"
import { extract, type Kind } from "@/history/extract"
import { testEffect, pollWithTimeout } from "../lib/effect"

// Test layer exposes History (search), Writer, Backfill, plus a SHARED Bus +
// Config so the writer subscribes to the same Bus instance we publish on.
const TestLayer = Layer.mergeAll(History.layer, writerLayer, backfillLayer).pipe(
  Layer.provideMerge(Layer.mergeAll(Config.defaultLayer, Bus.layer)),
)

const it = testEffect(TestLayer)

const ALL: ReadonlySet<Kind> = new Set<Kind>([
  "user_text",
  "assistant_text",
  "tool_input",
  "tool_error",
  "reasoning",
  "tool_output",
])

function textPart(text: string, ids?: { id?: string; session?: string; message?: string }): MessageV2.Part {
  return {
    id: (ids?.id ?? "prt_test") as PartID,
    sessionID: (ids?.session ?? "ses_test") as SessionID,
    messageID: (ids?.message ?? "msg_test") as MessageID,
    type: "text",
    text,
  } as MessageV2.Part
}

describe("history.fts-query", () => {
  test("tokenizes and AND-joins", () => {
    expect(buildFtsQuery("binary search")).toBe('"binary" AND "search"')
  })
  test("strips punctuation, preserves CJK", () => {
    expect(buildFtsQuery("hello, world!")).toBe('"hello" AND "world"')
    expect(buildFtsQuery("二分查找")).toBe('"二分查找"')
  })
  test("returns null for empty / punctuation-only", () => {
    expect(buildFtsQuery("")).toBeNull()
    expect(buildFtsQuery("   ,.!  ")).toBeNull()
  })
})

describe("history.extract", () => {
  test("user vs assistant text", () => {
    expect(extract(textPart("hi"), "user", ALL)).toEqual({ kind: "user_text", body: "hi", tool_name: null })
    expect(extract(textPart("hi"), "assistant", ALL)).toEqual({
      kind: "assistant_text",
      body: "hi",
      tool_name: null,
    })
  })
  test("respects disabled kinds", () => {
    const onlyUser = new Set<Kind>(["user_text"])
    expect(extract(textPart("hi"), "assistant", onlyUser)).toBeNull()
  })
  test("tool pending/running -> null", () => {
    const pending = { ...textPart(""), type: "tool", tool: "bash", state: { status: "pending" } } as any
    expect(extract(pending, "assistant", ALL)).toBeNull()
  })
  test("tool error / completed / input precedence", () => {
    const err = {
      ...textPart(""),
      type: "tool",
      tool: "bash",
      state: { status: "error", input: { cmd: "ls" }, error: "boom" },
    } as any
    expect(extract(err, "assistant", ALL)?.kind).toBe("tool_error")

    const done = {
      ...textPart(""),
      type: "tool",
      tool: "bash",
      state: { status: "completed", input: { cmd: "ls" }, output: "files" },
    } as any
    expect(extract(done, "assistant", ALL)?.kind).toBe("tool_output")

    const inputOnly = new Set<Kind>(["tool_input"])
    expect(extract(done, "assistant", inputOnly)?.kind).toBe("tool_input")
  })
})

describe("history.search (FTS5)", () => {
  it.instance("matches inserted rows, ranks, filters by kind/tool/time/scope", () =>
    Effect.gen(function* () {
      const history = yield* History.Service
      Database.use((db) =>
        db
          .insert(HistoryFtsTable)
          .values([
            {
              part_id: "p1",
              session_id: "s1",
              message_id: "m1",
              project_id: "projX",
              kind: "assistant_text",
              tool_name: null,
              body: "binary search implementation in python",
              time_created: 1000,
            },
            {
              part_id: "p2",
              session_id: "s1",
              message_id: "m2",
              project_id: "projX",
              kind: "tool_input",
              tool_name: "bash",
              body: "run binary build script",
              time_created: 2000,
            },
            {
              part_id: "p3",
              session_id: "s2",
              message_id: "m3",
              project_id: "projY",
              kind: "user_text",
              tool_name: null,
              body: "completely unrelated content",
              time_created: 3000,
            },
          ])
          .run(),
      )

      const hits = yield* history.search({ query: "binary", scope: "global" })
      expect(hits.length).toBe(2)
      expect(hits.some((h) => h.snippet.includes("binary"))).toBe(true)

      const byKind = yield* history.search({ query: "binary", scope: "global", kind: "tool_input" })
      expect(byKind.map((h) => h.part_id)).toEqual(["p2"])

      const byTool = yield* history.search({ query: "binary", scope: "global", tool_name: "bash" })
      expect(byTool.map((h) => h.part_id)).toEqual(["p2"])

      const byTime = yield* history.search({ query: "binary", scope: "global", time_after: 1500 })
      expect(byTime.map((h) => h.part_id)).toEqual(["p2"])

      const bySession = yield* history.search({ query: "unrelated", scope: "global", session_id: "s2" })
      expect(bySession.map((h) => h.part_id)).toEqual(["p3"])

      const empty = yield* history.search({ query: "   ,.! ", scope: "global" })
      expect(empty).toEqual([])
    }),
  )

  it.instance("writer indexes a published PartUpdated and removes on PartRemoved", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const writer = yield* WriterService
      yield* writer.init()

      const part = textPart("the quick brown fox jumps over", {
        id: "prt_e2e",
        session: "ses_e2e",
        message: "msg_e2e",
      })
      yield* bus.publish(MessageV2.Event.PartUpdated, {
        sessionID: part.sessionID,
        part,
        time: 1000,
      })

      const indexed = yield* pollWithTimeout(
        Effect.sync(() => {
          const row = Database.use((db) => db.select().from(HistoryFtsTable).all()).find(
            (r) => r.part_id === "prt_e2e",
          )
          return row ?? undefined
        }),
        "history writer did not index the published part",
      )
      expect(indexed.body).toBe("the quick brown fox jumps over")

      const hits = yield* (yield* History.Service).search({ query: "quick fox", scope: "global" })
      expect(hits.some((h) => h.part_id === "prt_e2e")).toBe(true)

      yield* bus.publish(MessageV2.Event.PartRemoved, {
        sessionID: part.sessionID,
        messageID: part.messageID,
        partID: part.id,
      })
      yield* pollWithTimeout(
        Effect.sync(() => {
          const gone = !Database.use((db) => db.select().from(HistoryFtsTable).all()).some(
            (r) => r.part_id === "prt_e2e",
          )
          return gone ? true : undefined
        }),
        "history writer did not remove the part",
      )
    }),
  )
})
