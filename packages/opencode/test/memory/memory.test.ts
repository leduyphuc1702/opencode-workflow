import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, writeFile, rm } from "fs/promises"
import path from "path"
import { Memory } from "@/memory"
import { buildFtsQuery } from "@/memory/fts-query"
import { testEffect } from "../lib/effect"

const it = testEffect(Memory.defaultLayer)

// Unique tokens so searches match only this test's files regardless of any
// other memory files present under the (tmp, XDG-isolated) data dir.
const TOKEN = "xylophonezqq"
const SID = "ses_memtest_zqq"

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
})
