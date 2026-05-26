import { afterEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { CodeGraph } from "@/codegraph"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(CodeGraph.defaultLayer)
const previousBin = process.env.OPENCODE_CODEGRAPH_BIN

afterEach(async () => {
  if (previousBin === undefined) delete process.env.OPENCODE_CODEGRAPH_BIN
  else process.env.OPENCODE_CODEGRAPH_BIN = previousBin
  await disposeAllInstances()
})

describe("codegraph.service", () => {
  it.instance("initializes, indexes, and reports progress before becoming ready", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const bin = path.join(test.directory, "fake-codegraph.js")
      yield* Effect.promise(() => Bun.write(bin, fakeCodeGraphCli()))
      yield* Effect.promise(() => fs.chmod(bin, 0o755))
      process.env.OPENCODE_CODEGRAPH_BIN = bin

      const service = yield* CodeGraph.Service
      const progress: number[] = []
      const status = yield* service.ensureReady({
        onProgress: (item) =>
          Effect.sync(() => {
            progress.push(item.percent)
          }),
      })

      expect(status.status).toBe("ready")
      expect(status.initialized).toBe(true)
      expect(status.version).toBe("0.0.0-test")
      expect(progress).toContain(5)
      expect(progress).toContain(20)
      expect(progress).toContain(45)
      expect(progress).toContain(100)
    }),
  )
})

function fakeCodeGraphCli() {
  return `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const command = args[0]
const project = args.find((arg) => arg.startsWith('/')) || process.cwd()
const marker = path.join(project, '.fake-codegraph-ready')

if (command === '--version') {
  console.log('0.0.0-test')
  process.exit(0)
}

if (command === 'status') {
  const initialized = fs.existsSync(marker)
  console.log(JSON.stringify({
    initialized,
    pendingChanges: { added: 0, modified: 0, removed: 0 }
  }))
  process.exit(0)
}

if (command === 'init' || command === 'index' || command === 'sync') {
  fs.writeFileSync(marker, 'ready')
  process.exit(0)
}

console.error('unexpected command: ' + args.join(' '))
process.exit(1)
`
}
