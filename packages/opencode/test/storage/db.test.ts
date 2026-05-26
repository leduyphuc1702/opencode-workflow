import { describe, expect, it as bunIt } from "bun:test"
import path from "path"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@/storage/db"
import { init } from "#db"
import { it } from "../lib/effect"

describe("Database.getChannelPath", () => {
  it.effect("returns database path for the current channel", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service
      const expected = ["latest", "beta", "prod"].includes(InstallationChannel)
        ? path.join(Global.Path.data, "opencode.db")
        : path.join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)

      expect(Database.getChannelPath(flags)).toBe(expected)
    }).pipe(Effect.provide(RuntimeFlags.layer())),
  )

  it.effect("uses the shared database path when channel databases are disabled", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(Database.getChannelPath(flags)).toBe(path.join(Global.Path.data, "opencode.db"))
    }).pipe(Effect.provide(RuntimeFlags.layer({ disableChannelDb: true }))),
  )

  it.effect("accepts RuntimeFlags with skipMigrations for database callers", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(flags.skipMigrations).toBe(true)
      expect(Database.getChannelPath(flags)).toBe(Database.getChannelPath({ disableChannelDb: flags.disableChannelDb }))
    }).pipe(Effect.provide(RuntimeFlags.layer({ skipMigrations: true }))),
  )

  bunIt("creates parent directories for file-backed databases before enabling WAL", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-db-init-"))
    const dbPath = path.join(root, "missing", "nested", "opencode.db")

    try {
      const db = init(dbPath)
      try {
        db.run("PRAGMA journal_mode = WAL")

        expect(await Bun.file(dbPath).exists()).toBe(true)
      } finally {
        db.$client.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
