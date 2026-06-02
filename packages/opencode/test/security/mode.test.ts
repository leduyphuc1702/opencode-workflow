import { describe, expect, test } from "bun:test"
import path from "path"
import { Permission } from "../../src/permission"
import { deriveRules, isInsideWorkspace, isProtectedPath } from "../../src/security/mode"

const cwd = path.join(process.cwd(), "workspace")
const protectedPaths = ["~/.ssh", ".env", ".git/config", "/etc"]

const action = (mode: string | undefined, permission: string, pattern: string, additionalDirectories: string[] = []) =>
  Permission.evaluate(permission, pattern, deriveRules(mode, { cwd, protectedPaths, additionalDirectories })).action

describe("security.mode", () => {
  test("default mode adds no rules and leaves every permission asking", () => {
    expect(deriveRules("default", { cwd, protectedPaths })).toEqual([])
    expect(action("default", "edit", "src/app.ts")).toBe("ask")
    expect(action("default", "write", "src/app.ts")).toBe("ask")
    expect(action("default", "bash", "ls")).toBe("ask")
    expect(action("default", "read", "src/app.ts")).toBe("ask")
  })

  test("plan mode denies mutation permissions and leaves reads at ask", () => {
    expect(action("plan", "edit", "src/app.ts")).toBe("deny")
    expect(action("plan", "write", "src/app.ts")).toBe("deny")
    expect(action("plan", "bash", "ls")).toBe("deny")
    expect(action("plan", "read", "src/app.ts")).toBe("ask")
  })

  test("acceptEdits mode allows edits and writes in the workspace only", () => {
    expect(action("acceptEdits", "edit", "src/app.ts")).toBe("allow")
    expect(action("acceptEdits", "write", "src/app.ts")).toBe("allow")
    expect(action("acceptEdits", "bash", "ls")).toBe("ask")
    expect(action("acceptEdits", "read", "src/app.ts")).toBe("ask")
  })

  test("acceptEdits does not auto-allow external paths", () => {
    expect(action("acceptEdits", "edit", "../outside/app.ts")).toBe("ask")
    expect(action("acceptEdits", "write", "/tmp/outside/app.ts")).toBe("ask")
  })

  test("additional directories widen acceptEdits file and external directory rules", () => {
    const additional = path.resolve(cwd, "..", "shared")
    const relativeFile = path.relative(cwd, path.join(additional, "app.ts"))

    expect(action("acceptEdits", "edit", relativeFile)).toBe("ask")
    expect(action("acceptEdits", "edit", relativeFile, [additional])).toBe("allow")
    expect(action("acceptEdits", "external_directory", `${additional}/*`, [additional])).toBe("allow")
  })

  test("bypassPermissions mode allows edit, write, bash, and read", () => {
    expect(action("bypassPermissions", "edit", "src/app.ts")).toBe("allow")
    expect(action("bypassPermissions", "write", "src/app.ts")).toBe("allow")
    expect(action("bypassPermissions", "bash", "ls")).toBe("allow")
    expect(action("bypassPermissions", "read", "src/app.ts")).toBe("allow")
  })

  test("protected paths override acceptEdits and bypassPermissions", () => {
    expect(action("acceptEdits", "edit", ".env")).toBe("ask")
    expect(action("bypassPermissions", "edit", ".git/config")).toBe("ask")
    expect(action("bypassPermissions", "bash", "cat .env")).toBe("ask")
    expect(action("bypassPermissions", "read", "/etc/passwd")).toBe("ask")
  })

  test("unknown modes fail closed without auto-allow rules", () => {
    expect(deriveRules("auto", { cwd, protectedPaths })).toEqual([])
    expect(action("auto", "edit", "src/app.ts")).toBe("ask")
  })

  test("detects protected paths", () => {
    expect(isProtectedPath(".env.local", protectedPaths)).toBe(true)
    expect(isProtectedPath("packages/app/.git/config", protectedPaths)).toBe(true)
    expect(isProtectedPath("/etc/hosts", protectedPaths)).toBe(true)
    expect(isProtectedPath("src/app.ts", protectedPaths)).toBe(false)
  })

  test("detects workspace and additional directory boundaries", () => {
    const additional = path.resolve(cwd, "..", "shared")

    expect(isInsideWorkspace(path.join(cwd, "src/app.ts"), cwd)).toBe(true)
    expect(isInsideWorkspace(path.join(additional, "app.ts"), cwd)).toBe(false)
    expect(isInsideWorkspace(path.join(additional, "app.ts"), cwd, [additional])).toBe(true)
    expect(isInsideWorkspace(path.resolve(cwd, "..", "outside.ts"), cwd)).toBe(false)
  })

  test("security rules win over a persisted 'always allow' approval (deny-first precedence)", () => {
    // Simulates a prior `bash *` / `edit *` "allow always" approval persisted in
    // the approved ruleset. Security rules are passed LAST (as priority) so they
    // must override the stale allow. This mirrors the call in session/tools.ts.
    const approved = [
      { permission: "bash", pattern: "*", action: "allow" as const },
      { permission: "edit", pattern: "*", action: "allow" as const },
    ]
    const security = deriveRules("plan", { cwd, protectedPaths })
    expect(Permission.evaluate("bash", "ls", approved, security).action).toBe("deny")
    expect(Permission.evaluate("edit", "src/app.ts", approved, security).action).toBe("deny")

    const bypass = deriveRules("bypassPermissions", { cwd, protectedPaths })
    // protected path still asks even with a prior approved allow + bypass allow.
    expect(Permission.evaluate("edit", ".env", approved, bypass).action).toBe("ask")
  })
})
