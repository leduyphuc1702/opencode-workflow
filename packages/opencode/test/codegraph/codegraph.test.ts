import { afterEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { CodeGraph } from "@/codegraph"
import { InstanceRef } from "@/effect/instance-ref"
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

  it.instance("initializes the exact project when a parent directory already has CodeGraph", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* InstanceRef
      const child = path.join(test.directory, "child")
      const bin = path.join(test.directory, "fake-codegraph.js")
      yield* Effect.promise(() => fs.mkdir(path.join(test.directory, ".codegraph"), { recursive: true }))
      yield* Effect.promise(() => Bun.write(path.join(test.directory, ".codegraph", "codegraph.db"), "parent"))
      yield* Effect.promise(() => fs.mkdir(child, { recursive: true }))
      yield* Effect.promise(() => Bun.write(bin, fakeCodeGraphCli()))
      yield* Effect.promise(() => fs.chmod(bin, 0o755))
      process.env.OPENCODE_CODEGRAPH_BIN = bin

      const service = yield* CodeGraph.Service
      const childInstance = {
        ...instance!,
        directory: child,
      }
      const before = yield* service.status().pipe(Effect.provideService(InstanceRef, childInstance))
      const status = yield* service.ensureReady().pipe(Effect.provideService(InstanceRef, childInstance))

      expect(before.status).toBe("idle")
      expect(before.initialized).toBe(false)
      expect(
        yield* Effect.promise(() =>
          fs
            .stat(path.join(child, ".codegraph", "codegraph.db"))
            .then(() => true)
            .catch(() => false),
        ),
      ).toBe(true)
      expect(status.status).toBe("ready")
      expect(status.initialized).toBe(true)
    }),
  )
})

function fakeCodeGraphCli() {
  return `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const command = args[0]
const projectArg = args.find((arg) => arg.startsWith('/')) || process.cwd()

function dbPath(project) {
  return path.join(project, '.codegraph', 'codegraph.db')
}

function isInitialized(project) {
  return fs.existsSync(dbPath(project))
}

function resolveProjectPath(input) {
  let current = path.resolve(input)
  if (isInitialized(current)) return current

  const root = path.parse(current).root
  while (current !== root) {
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
    if (isInitialized(current)) return current
  }

  return path.resolve(input)
}

function initProject(project) {
  fs.mkdirSync(path.join(project, '.codegraph'), { recursive: true })
  fs.writeFileSync(dbPath(project), 'ready')
}

if (command === '--version') {
  console.log('0.0.0-test')
  process.exit(0)
}

if (command === 'status') {
  const project = resolveProjectPath(projectArg)
  const initialized = isInitialized(project)
  console.log(JSON.stringify({
    initialized,
    projectPath: project,
    pendingChanges: { added: 0, modified: 0, removed: 0 }
  }))
  process.exit(0)
}

if (command === 'init') {
  initProject(path.resolve(projectArg))
  process.exit(0)
}

if (command === 'index' || command === 'sync') {
  const project = resolveProjectPath(projectArg)
  if (!isInitialized(project)) process.exit(1)
  process.exit(0)
}

console.error('unexpected command: ' + args.join(' '))
process.exit(1)
`
}
