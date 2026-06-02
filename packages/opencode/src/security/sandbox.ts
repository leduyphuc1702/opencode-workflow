import os from "os"
import path from "path"

export type Mode = "workspace-write" | "read-only"

export type Policy = {
  enabled?: boolean
  mode?: Mode
  allowNetwork?: boolean
  cwd: string
  shell: string
  platform?: NodeJS.Platform
}

export type Wrapped =
  | { kind: "passthrough"; command: string; args: string[] }
  | { kind: "wrapped"; command: string; args: string[]; profile?: string }
  | { kind: "blocked"; reason: string }

const credentialPaths = ["~/.ssh", ".env", ".git/config"] as const

export function wrap(command: string, policy: Policy): Wrapped {
  if (policy.enabled !== true) return { kind: "passthrough", command, args: [] }
  const platform = policy.platform ?? process.platform
  if (platform === "darwin") return darwin(command, policy)
  if (platform === "linux") return linux(command, policy)
  return { kind: "blocked", reason: `security sandbox is not available on ${platform}` }
}

function darwin(command: string, policy: Policy): Wrapped {
  const profile = [
    "(version 1)",
    "(deny default)",
    "(import \"system.sb\")",
    "(allow process*)",
    policy.allowNetwork ? "(allow network*)" : "(deny network*)",
    `(allow file-read* ${readPaths(policy.cwd).map(subpath).join(" ")})`,
    policy.mode === "read-only" ? undefined : `(allow file-write* ${subpath(policy.cwd)})`,
    ...denyCredentialPaths(policy.cwd).map((item) => `(deny file-read* ${subpath(item)})`),
    ...denyCredentialPaths(policy.cwd).map((item) => `(deny file-write* ${subpath(item)})`),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")

  return { kind: "wrapped", command: "sandbox-exec", args: ["-p", profile, policy.shell, "-lc", command], profile }
}

function linux(command: string, policy: Policy): Wrapped {
  const args = [
    "--unshare-all",
    ...(policy.allowNetwork ? ["--share-net"] : []),
    "--die-with-parent",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/bin",
    "/bin",
    "--ro-bind",
    "/lib",
    "/lib",
    ...(policy.mode === "read-only" ? ["--ro-bind", policy.cwd, policy.cwd] : ["--bind", policy.cwd, policy.cwd]),
    ...denyCredentialPaths(policy.cwd).flatMap(maskCredentialPath),
    "--chdir",
    policy.cwd,
    policy.shell,
    "-lc",
    command,
  ]

  return { kind: "wrapped", command: "bwrap", args }
}

function readPaths(cwd: string) {
  return unique(["/bin", "/usr", "/lib", "/System", "/Library", cwd, os.tmpdir()])
}

function denyCredentialPaths(cwd: string) {
  return credentialPaths.map((item) => path.resolve(cwd, expandHome(item)))
}

function maskCredentialPath(input: string) {
  if (input.endsWith("/.ssh")) return ["--tmpfs", input]
  return ["--ro-bind", "/dev/null", input]
}

function expandHome(input: string) {
  if (input === "~") return os.homedir()
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(os.homedir(), input.slice(2))
  return input
}

function subpath(input: string) {
  return `(subpath ${JSON.stringify(input)})`
}

function unique(items: readonly string[]) {
  return [...new Set(items.filter(Boolean))]
}

export * as SecuritySandbox from "./sandbox"
