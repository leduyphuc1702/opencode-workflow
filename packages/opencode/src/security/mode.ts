import os from "os"
import path from "path"
import type { Permission } from "@/permission"

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"

type Options = {
  protectedPaths: readonly string[]
  additionalDirectories?: readonly string[]
  cwd: string
}

const editPermissions = ["edit", "write"] as const
const mutationPermissions = ["edit", "write", "bash"] as const

export function deriveRules(permissionMode: string | undefined, opts: Options): Permission.Rule[] {
  if (permissionMode === "plan") return mutationPermissions.map((permission) => rule(permission, "*", "deny"))
  if (permissionMode === "acceptEdits") {
    return [
      ...editPermissions.map((permission) => rule(permission, "*", "allow")),
      ...editPermissions.flatMap((permission) => [rule(permission, "../*", "ask"), rule(permission, "/*", "ask")]),
      ...additionalDirectoryRules(opts),
      ...protectedRules(opts.protectedPaths),
    ]
  }
  if (permissionMode === "bypassPermissions") return [rule("*", "*", "allow"), ...protectedRules(opts.protectedPaths)]
  return []
}

export function isProtectedPath(input: string, protectedPaths: readonly string[]) {
  const target = normalize(expandHome(input))
  return protectedPaths.some((item) => protectedPathMatches(target, normalize(expandHome(item))))
}

export function isInsideWorkspace(input: string, cwd: string, additionalDirectories: readonly string[] = []) {
  const target = path.resolve(cwd, expandHome(input))
  return [cwd, ...additionalDirectories].some((dir) => inside(target, path.resolve(cwd, expandHome(dir))))
}

function additionalDirectoryRules(opts: Options): Permission.Rule[] {
  return (opts.additionalDirectories ?? []).flatMap((dir) =>
    isInsideWorkspace(dir, opts.cwd) ? [] : directoryPatterns(dir, opts.cwd).flatMap(allowEditAndExternalDirectory),
  )
}

function allowEditAndExternalDirectory(pattern: string): Permission.Rule[] {
  return [
    ...editPermissions.map((permission) => rule(permission, pattern, "allow")),
    rule("external_directory", pattern, "allow"),
  ]
}

function protectedRules(protectedPaths: readonly string[]): Permission.Rule[] {
  return protectedPaths.flatMap((item) => protectedPatterns(item).map((pattern) => rule("*", pattern, "ask")))
}

function protectedPatterns(input: string) {
  const normalized = normalize(expandHome(input))
  const glob = `*${normalized}*`
  return unique([normalized, `${normalized}/*`, glob])
}

function directoryPatterns(input: string, cwd: string) {
  const absolute = normalize(path.resolve(cwd, expandHome(input)))
  const relative = normalize(path.relative(cwd, absolute))
  return unique([absolute, `${absolute}/*`, relative, `${relative}/*`])
}

function protectedPathMatches(target: string, protectedPath: string) {
  if (path.isAbsolute(protectedPath)) return target === protectedPath || target.startsWith(`${protectedPath}/`)
  if (protectedPath === ".env") return path.basename(target) === ".env" || path.basename(target).startsWith(".env.")
  return target === protectedPath || target.endsWith(`/${protectedPath}`) || target.includes(`/${protectedPath}/`)
}

function inside(target: string, root: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function expandHome(input: string) {
  if (input === "~") return os.homedir()
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(os.homedir(), input.slice(2))
  return input
}

function normalize(input: string) {
  return input.replaceAll("\\", "/")
}

function unique(items: readonly string[]) {
  return [...new Set(items.filter(Boolean))]
}

function rule(permission: string, pattern: string, action: Permission.Action): Permission.Rule {
  return { permission, pattern, action }
}

export * as SecurityMode from "./mode"
