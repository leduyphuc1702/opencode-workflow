import { describe, expect, test } from "bun:test"
import type { Policy } from "../../src/security/sandbox"
import { wrap } from "../../src/security/sandbox"

const policy = {
  enabled: true,
  mode: "workspace-write",
  cwd: "/repo/workspace",
  shell: "/bin/zsh",
} satisfies Omit<Policy, "platform">

describe("security.sandbox", () => {
  test("returns passthrough when disabled", () => {
    expect(wrap("echo ok", { ...policy, enabled: false, platform: "darwin" })).toEqual({
      kind: "passthrough",
      command: "echo ok",
      args: [],
    })
  })

  test("generates a macOS sandbox-exec profile and argv", () => {
    const wrapped = wrap("echo ok", { ...policy, platform: "darwin" })

    expect(wrapped.kind).toBe("wrapped")
    if (wrapped.kind !== "wrapped") return
    expect(wrapped.command).toBe("sandbox-exec")
    expect(wrapped.args.slice(-3)).toEqual(["/bin/zsh", "-lc", "echo ok"])
    expect(wrapped.profile).toContain('(allow file-write* (subpath "/repo/workspace"))')
    expect(wrapped.profile).toContain(".ssh")
    expect(wrapped.profile).toContain(".env")
  })

  test("generates a Linux bubblewrap argv", () => {
    const wrapped = wrap("echo ok", { ...policy, platform: "linux" })

    expect(wrapped.kind).toBe("wrapped")
    if (wrapped.kind !== "wrapped") return
    expect(wrapped.command).toBe("bwrap")
    expect(wrapped.args).toContain("--bind")
    expect(wrapped.args).toContain("/repo/workspace")
    expect(wrapped.args).toContain("--tmpfs")
    expect(wrapped.args.some((item) => item.endsWith("/.ssh"))).toBe(true)
    expect(wrapped.args.slice(-3)).toEqual(["/bin/zsh", "-lc", "echo ok"])
  })

  test("supports read-only mode and shared network generation", () => {
    const wrapped = wrap("git status", { ...policy, mode: "read-only", allowNetwork: true, platform: "linux" })

    expect(wrapped.kind).toBe("wrapped")
    if (wrapped.kind !== "wrapped") return
    expect(wrapped.args).toContain("--share-net")
    expect(wrapped.args).toContain("--ro-bind")
  })

  test("blocks unsupported platforms when enabled", () => {
    expect(wrap("echo ok", { ...policy, platform: "win32" })).toEqual({
      kind: "blocked",
      reason: "security sandbox is not available on win32",
    })
  })
})
