import { describe, expect, test } from "bun:test"
import { build, isEmpty, summarize } from "../../src/security/finding"

describe("security.finding", () => {
  test("builds a finding from analysis and redacted secrets", () => {
    const finding = build(
      { level: "medium", decision: "ask", reasons: ["unrecognized command: node"] },
      [{ type: "github", line: 2, redacted: "ghp_...wxyz" }],
    )

    expect(finding).toEqual({
      level: "high",
      decision: "ask",
      reasons: ["unrecognized command: node"],
      secrets: [{ type: "github", line: 2, redacted: "ghp_...wxyz" }],
    })
  })

  test("keeps irreversible level above the secret high floor", () => {
    expect(
      build({ level: "irreversible", decision: "deny", reasons: ["destructive command: rm"] }, [
        { type: "aws", line: 1, redacted: "AKIA...CDEF" },
      ]).level,
    ).toBe("irreversible")
  })

  test("summarizes without emitting raw secret values", () => {
    const raw = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    const summary = summarize(
      build({ level: "medium", decision: "ask", reasons: ["reason with\nnewline"] }, [
        { type: "github", line: 3, redacted: "ghp_...wxyz" },
      ]),
    )

    expect(summary).toBe("Security: high/ask; reasons: reason with newline; secrets: github line 3: ghp_...wxyz")
    expect(summary).not.toContain(raw)
  })

  test("detects empty findings", () => {
    expect(isEmpty(undefined)).toBe(true)
    expect(isEmpty({ level: "low", reasons: [], secrets: [] })).toBe(true)
    expect(isEmpty({ level: "low", reasons: ["read-only command: ls"], secrets: [] })).toBe(false)
  })
})
