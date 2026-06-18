import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, writeFile, rm } from "fs/promises"
import path from "path"
import { Memory } from "@/memory"
import { buildFtsQuery, parseFields } from "@/memory/fts-query"
import { testEffect } from "../lib/effect"

const it = testEffect(Memory.defaultLayer)

// Unique tokens so searches match only this test's files regardless of any
// other memory files present under the (tmp, XDG-isolated) data dir.
const TOKEN = "xylophonezqq"
const SID = "ses_memtest_zqq"
const TOKEN2 = "kazoozqq"
const SID2 = "ses_memtest2_zqq"

describe("memory.fts-query", () => {
  test("OR-joins tokens, strips punctuation, keeps CJK", () => {
    expect(buildFtsQuery("binary search")).toBe('"binary" OR "search"')
    expect(buildFtsQuery("hello, world!")).toBe('"hello" OR "world"')
    expect(buildFtsQuery("二分查找")).toBe('"二分查找"')
  })
  test("null on empty / punctuation-only", () => {
    expect(buildFtsQuery("")).toBeNull()
    expect(buildFtsQuery("  ... !! ")).toBeNull()
  })
  test("parseFields extracts known prefixes, leaves rest", () => {
    expect(parseFields("type:checkpoint deadlock", ["type", "scope", "path"])).toEqual({
      fields: { type: ["checkpoint"] },
      rest: "deadlock",
    })
    // unknown prefix (and URL-like host:port) stays verbatim in rest
    expect(parseFields("postgres://h foo", ["type"])).toEqual({ fields: {}, rest: "postgres://h foo" })
    // repeated field -> multiple values; path keeps its value verbatim
    expect(parseFields("path:src/api type:notes term", ["type", "path"])).toEqual({
      fields: { path: ["src/api"], type: ["notes"] },
      rest: "term",
    })
  })
})

describe("memory.service", () => {
  it.instance("reconciles disk md files, searches, filters by scope/type, prunes", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const root = yield* memory.root()
      const dir = path.join(root, "sessions", SID)
      const taskDir = path.join(dir, "tasks", "T1")

      yield* Effect.promise(async () => {
        await mkdir(taskDir, { recursive: true })
        await writeFile(path.join(dir, "memory.md"), `# Memory\n${TOKEN} durable architecture decision`)
        await writeFile(path.join(dir, "checkpoint.md"), `# Checkpoint\n${TOKEN} session state snapshot`)
        await writeFile(path.join(taskDir, "progress.md"), `# Progress\n${TOKEN} task progress log`)
      })

      const recon = yield* memory.reconcile()
      expect(recon.indexed).toBeGreaterThanOrEqual(3)

      const hits = yield* memory.search({ query: TOKEN, scope: "sessions", scope_id: SID })
      expect(hits.length).toBe(3)
      expect(hits.every((h) => h.snippet.includes(TOKEN))).toBe(true)
      expect(hits.every((h) => h.score > 0)).toBe(true)

      // type filter
      const onlyMemory = yield* memory.search({ query: TOKEN, scope: "sessions", scope_id: SID, type: "memory" })
      expect(onlyMemory.map((h) => h.type)).toEqual(["memory"])

      const onlyProgress = yield* memory.search({ query: TOKEN, scope: "sessions", scope_id: SID, type: "progress" })
      expect(onlyProgress.map((h) => h.type)).toEqual(["progress"])

      // prune: delete one file, reconcile, it disappears from search
      yield* Effect.promise(() => rm(path.join(dir, "checkpoint.md")))
      const recon2 = yield* memory.reconcile()
      expect(recon2.pruned).toBeGreaterThanOrEqual(1)
      const afterPrune = yield* memory.search({ query: TOKEN, scope: "sessions", scope_id: SID })
      expect(afterPrune.length).toBe(2)
      expect(afterPrune.some((h) => h.type === "checkpoint")).toBe(false)

      // cleanup test files
      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))
    }),
  )

  it.instance("inline field prefixes filter; type weight ranks curated above machine-generated", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const root = yield* memory.root()
      const dir = path.join(root, "sessions", SID2)

      // Equal-length bodies (one header token + the rare token + "alpha") so
      // raw BM25 ties — the type weight is what must order them.
      yield* Effect.promise(async () => {
        await mkdir(dir, { recursive: true })
        await writeFile(path.join(dir, "memory.md"), `Memory ${TOKEN2} alpha`)
        await writeFile(path.join(dir, "checkpoint.md"), `Checkpoint ${TOKEN2} alpha`)
      })
      yield* memory.reconcile()

      // Type weight: curated "memory" outranks machine "checkpoint" at tied BM25.
      const ranked = yield* memory.search({ query: TOKEN2, scope: "sessions", scope_id: SID2 })
      expect(ranked.length).toBe(2)
      expect(ranked[0].type).toBe("memory")

      // Inline type: prefix narrows to checkpoint only.
      const onlyCk = yield* memory.search({ query: `type:checkpoint ${TOKEN2}`, scope: "sessions", scope_id: SID2 })
      expect(onlyCk.map((h) => h.type)).toEqual(["checkpoint"])

      // Inline path: substring filter.
      const byPath = yield* memory.search({ query: `path:checkpoint ${TOKEN2}`, scope: "sessions", scope_id: SID2 })
      expect(byPath.length).toBe(1)
      expect(byPath[0].path.includes("checkpoint")).toBe(true)

      // Explicit arg overrides the inline prefix.
      const argWins = yield* memory.search({
        query: `type:checkpoint ${TOKEN2}`,
        type: "memory",
        scope: "sessions",
        scope_id: SID2,
      })
      expect(argWins.map((h) => h.type)).toEqual(["memory"])

      // Pure-filter query (no free term) returns [] — FTS needs a match term.
      const pure = yield* memory.search({ query: "type:checkpoint", scope: "sessions", scope_id: SID2 })
      expect(pure).toEqual([])

      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))
    }),
  )
})
