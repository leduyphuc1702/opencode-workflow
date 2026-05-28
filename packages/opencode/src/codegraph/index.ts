import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { promisify } from "node:util"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { FileWatcher } from "@/file/watcher"
import { Context, Effect, Layer, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const log = Log.create({ service: "codegraph" })
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024
const WATCH_DEBOUNCE_MS = 750

export const Status = Schema.Literals(["idle", "syncing", "ready", "stale", "failed"])
export type Status = Schema.Schema.Type<typeof Status>

export type Info = {
  status: Status
  projectPath: string
  binary?: string
  version?: string
  initialized?: boolean
  syncStartedAt?: string
  lastSyncAt?: string
  lastStatusAt?: string
  lastError?: string
  pendingChanges?: {
    added: number
    modified: number
    removed: number
  }
  raw?: unknown
}

type Binary = {
  command: string
  args: string[]
  label: string
  root?: string
  node?: string
}

export type CommandResult = {
  stdout: string
  stderr: string
  status: Info
}

export type Progress = {
  percent: number
  message: string
}

export type EnsureReadyOptions = {
  onProgress?: (progress: Progress) => Effect.Effect<void> | void
}

export interface Interface {
  readonly status: () => Effect.Effect<Info>
  readonly ensureReady: (options?: EnsureReadyOptions) => Effect.Effect<Info>
  readonly run: (args: string[], options?: { maxOutputBytes?: number }) => Effect.Effect<CommandResult>
  readonly runMcpTool: (
    tool: string,
    args: Record<string, unknown>,
    options?: { maxOutputBytes?: number },
  ) => Effect.Effect<CommandResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CodeGraph") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const state = yield* InstanceState.make(
      Effect.fn("CodeGraph.state")(function* (ctx) {
        const bridge = yield* EffectBridge.make()
        const binary = resolveBinary()
        let current: Info = {
          status: "idle",
          projectPath: ctx.directory,
          binary: binary?.label,
        }
        let syncTimer: ReturnType<typeof setTimeout> | undefined
        let syncing = false

        const runCli = Effect.fn("CodeGraph.runCli")(function* (
          args: string[],
          options?: { maxOutputBytes?: number; allowFailure?: boolean },
        ) {
          if (!binary) throw new Error("Bundled CodeGraph binary was not found")
          const result = yield* Effect.tryPromise({
            try: () =>
              execFileAsync(binary.command, [...binary.args, ...args], {
                cwd: ctx.directory,
                env: {
                  ...process.env,
                  CODEGRAPH_NO_DOWNLOAD: "1",
                },
                maxBuffer: options?.maxOutputBytes ?? MAX_OUTPUT_BYTES,
              }),
            catch: (error) => error,
          }).pipe(
            Effect.catch((error) => {
              if (!options?.allowFailure) return Effect.fail(error)
              const err = error as { stdout?: string | Buffer; stderr?: string | Buffer }
              return Effect.succeed({
                stdout: err.stdout ?? "",
                stderr: err.stderr ?? "",
              })
            }),
          )
          return {
            stdout: Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : String(result.stdout ?? ""),
            stderr: Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr ?? ""),
          }
        })

        const runMcpTool = Effect.fn("CodeGraph.runMcpTool")(function* (
          tool: string,
          args: Record<string, unknown>,
          options?: { maxOutputBytes?: number },
        ) {
          if (!binary) throw new Error("Bundled CodeGraph binary was not found")
          if (!binary.root || !binary.node) throw new Error("Bundled CodeGraph library was not found")
          const result = yield* Effect.tryPromise({
            try: () =>
              execFileAsync(
                binary.node!,
                [
                  "--liftoff-only",
                  "-e",
                  MCP_TOOL_RUNNER,
                  path.join(binary.root!, "lib", "dist", "index.js"),
                  path.join(binary.root!, "lib", "dist", "mcp", "tools.js"),
                  ctx.directory,
                  tool,
                  JSON.stringify(args),
                ],
                {
                  cwd: ctx.directory,
                  env: {
                    ...process.env,
                    CODEGRAPH_NO_DOWNLOAD: "1",
                  },
                  maxBuffer: options?.maxOutputBytes ?? MAX_OUTPUT_BYTES,
                },
              ),
            catch: (error) => error,
          })
          return {
            stdout: Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : String(result.stdout ?? ""),
            stderr: Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr ?? ""),
          }
        })

        const version = Effect.fn("CodeGraph.version")(function* () {
          if (current.version) return current.version
          const result = yield* runCli(["--version"], { allowFailure: true }).pipe(Effect.orElseSucceed(() => undefined))
          const value = result?.stdout.trim() || undefined
          current = { ...current, version: value }
          return value
        })

        const readStatus = Effect.fn("CodeGraph.readStatus")(function* () {
          if (!isProjectInitialized(ctx.directory)) {
            current = {
              ...current,
              status: "idle",
              initialized: false,
              version: yield* version(),
              lastStatusAt: new Date().toISOString(),
              pendingChanges: { added: 0, modified: 0, removed: 0 },
              raw: undefined,
            }
            return current
          }

          const result = yield* runCli(["status", ctx.directory, "-j"], { allowFailure: true })
          const raw = parseJson(result.stdout)
          const pending = pendingChanges(raw)
          const initialized = isRecord(raw) && raw.initialized === true && statusMatchesProject(raw, ctx.directory)
          const status: Status = !initialized
            ? "idle"
            : pending.added + pending.modified + pending.removed > 0
              ? "stale"
              : "ready"
          current = {
            ...current,
            status,
            initialized,
            version: yield* version(),
            lastStatusAt: new Date().toISOString(),
            pendingChanges: pending,
            raw,
          }
          return current
        })

        const report = Effect.fn("CodeGraph.reportProgress")(function* (
          options: EnsureReadyOptions | undefined,
          progress: Progress,
        ) {
          const result = options?.onProgress?.(progress)
          if (Effect.isEffect(result)) yield* result
        })

        const sync = Effect.fn("CodeGraph.sync")(function* (options?: EnsureReadyOptions) {
          if (syncing) {
            yield* report(options, { percent: 1, message: "CodeGraph sync already running" })
            while (syncing) yield* Effect.sleep("250 millis")
            if (current.status === "failed") throw new Error(current.lastError ?? "CodeGraph sync failed")
            yield* report(options, { percent: 100, message: "CodeGraph ready" })
            return current
          }
          syncing = true
          current = {
            ...current,
            status: "syncing",
            syncStartedAt: new Date().toISOString(),
            lastError: undefined,
          }
          try {
            yield* report(options, { percent: 5, message: "Checking CodeGraph status" })
            const before = yield* readStatus()
            if (!before.initialized) {
              yield* report(options, { percent: 20, message: "Initializing CodeGraph" })
              yield* runCli(["init", ctx.directory])
              yield* report(options, { percent: 45, message: "Indexing codebase" })
              yield* runCli(["index", ctx.directory, "-q"])
            } else {
              yield* report(options, { percent: 35, message: "Syncing CodeGraph" })
              yield* runCli(["sync", ctx.directory, "-q"])
            }
            yield* report(options, { percent: 90, message: "Validating CodeGraph index" })
            const after = yield* readStatus()
            current = {
              ...after,
              status: after.status === "idle" ? "failed" : after.status,
              lastSyncAt: new Date().toISOString(),
              lastError: undefined,
            }
            if (current.status === "failed") throw new Error("CodeGraph did not initialize")
            yield* report(options, { percent: 100, message: "CodeGraph ready" })
            return current
          } catch (error) {
            current = {
              ...current,
              status: "failed",
              lastError: error instanceof Error ? error.message : String(error),
            }
            throw error
          } finally {
            syncing = false
          }
        })

        const unsubscribe = yield* bus.subscribeCallback(FileWatcher.Event.Updated, (event) => {
          const relative = path.relative(ctx.directory, event.properties.file)
          if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return
          if (relative === ".codegraph" || relative.startsWith(`.codegraph${path.sep}`)) return
          if (syncTimer) clearTimeout(syncTimer)
          syncTimer = setTimeout(() => {
            bridge.fork(
              sync().pipe(
                Effect.catch((error) => {
                  log.error("watch sync failed", { error })
                  return Effect.void
                }),
                Effect.orDie,
              ),
            )
          }, WATCH_DEBOUNCE_MS)
        })
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            unsubscribe()
            if (syncTimer) clearTimeout(syncTimer)
          }),
        )

        return {
          status: readStatus,
          ensureReady: sync,
          run: Effect.fn("CodeGraph.run")(function* (args: string[], options?: { maxOutputBytes?: number }) {
            const status = yield* sync()
            const result = yield* runCli(args, options)
            return { ...result, status }
          }),
          runMcpTool: Effect.fn("CodeGraph.runMcpToolPublic")(function* (
            tool: string,
            args: Record<string, unknown>,
            options?: { maxOutputBytes?: number },
          ) {
            const status = yield* sync()
            const result = yield* runMcpTool(tool, args, options)
            return { ...result, status }
          }),
        }
      }),
    )

    return Service.of({
      status: Effect.fn("CodeGraph.status")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.status()).pipe(Effect.orDie)
      }),
      ensureReady: Effect.fn("CodeGraph.ensureReady")(function* (options?: EnsureReadyOptions) {
        return yield* InstanceState.useEffect(state, (s) => s.ensureReady(options)).pipe(Effect.orDie)
      }),
      run: Effect.fn("CodeGraph.run")(function* (args: string[], options?: { maxOutputBytes?: number }) {
        return yield* InstanceState.useEffect(state, (s) => s.run(args, options)).pipe(Effect.orDie)
      }),
      runMcpTool: Effect.fn("CodeGraph.runMcpTool")(function* (
        tool: string,
        args: Record<string, unknown>,
        options?: { maxOutputBytes?: number },
      ) {
        return yield* InstanceState.useEffect(state, (s) => s.runMcpTool(tool, args, options)).pipe(Effect.orDie)
      }),
    })
  }),
)

const MCP_TOOL_RUNNER = String.raw`
const CodeGraph = require(process.argv[1]).default
const { ToolHandler } = require(process.argv[2])
const project = process.argv[3]
const tool = process.argv[4]
const args = JSON.parse(process.argv[5] || '{}')

Promise.resolve()
  .then(async () => {
    const graph = CodeGraph.openSync(project)
    const handler = new ToolHandler(graph)
    try {
      const result = await handler.execute(tool, args)
      const text = Array.isArray(result.content)
        ? result.content.map((item) => item && item.type === 'text' ? item.text : '').filter(Boolean).join('\n')
        : ''
      process.stdout.write(text)
      if (result.isError) process.exitCode = 1
    } finally {
      handler.closeAll()
      graph.close()
    }
  })
  .catch((error) => {
    process.stderr.write(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
`

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

function resolveBinary(): Binary | undefined {
  if (process.env.OPENCODE_CODEGRAPH_BIN) {
    return { command: process.env.OPENCODE_CODEGRAPH_BIN, args: [], label: process.env.OPENCODE_CODEGRAPH_BIN }
  }

  const packaged = resolvePackagedBundle()
  if (packaged) return packaged

  const platform = resolvePlatformPackage()
  if (platform) return platform

  return resolveMainPackage()
}

function resolvePackagedBundle(): Binary | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!resourcesPath) return
  return launcherIn(path.join(resourcesPath, "codegraph"))
}

function resolvePlatformPackage(): Binary | undefined {
  const name = `codegraph-${process.platform}-${process.arch}`
  const direct = packageDir(`@colbymchenry/${name}`)
  if (direct) return launcherIn(direct)

  const main = packageDir("@colbymchenry/codegraph")
  if (!main) return
  return launcherIn(path.join(main, "..", name))
}

function resolveMainPackage(): Binary | undefined {
  const dir = packageDir("@colbymchenry/codegraph")
  if (!dir) return
  const manifest = readJson(path.join(dir, "package.json"))
  const bin = isRecord(manifest) && isRecord(manifest.bin) && typeof manifest.bin.codegraph === "string"
    ? path.join(dir, manifest.bin.codegraph)
    : path.join(dir, "dist", "bin", "codegraph.js")
  if (!existsSync(bin)) return
  return { command: bin, args: [], label: bin }
}

function launcherIn(dir: string): Binary | undefined {
  if (process.platform === "win32") {
    const node = path.join(dir, "node.exe")
    const entry = path.join(dir, "lib", "dist", "bin", "codegraph.js")
    if (existsSync(node) && existsSync(entry)) {
      return { command: node, args: ["--liftoff-only", entry], label: dir, root: dir, node }
    }
    return
  }
  const launcher = path.join(dir, "bin", "codegraph")
  if (!existsSync(launcher)) return
  const node = path.join(dir, "node")
  return { command: launcher, args: [], label: launcher, root: dir, node: existsSync(node) ? node : undefined }
}

function packageDir(name: string): string | undefined {
  try {
    return path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    return
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return
  }
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

function isProjectInitialized(projectPath: string) {
  return existsSync(path.join(projectPath, ".codegraph", "codegraph.db"))
}

function statusMatchesProject(value: Record<string, unknown>, projectPath: string) {
  if (typeof value.projectPath !== "string") return true
  return path.resolve(value.projectPath) === path.resolve(projectPath)
}

function pendingChanges(value: unknown) {
  if (!isRecord(value) || !isRecord(value.pendingChanges)) return { added: 0, modified: 0, removed: 0 }
  return {
    added: numberValue(value.pendingChanges.added),
    modified: numberValue(value.pendingChanges.modified),
    removed: numberValue(value.pendingChanges.removed),
  }
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export * as CodeGraph from "."
