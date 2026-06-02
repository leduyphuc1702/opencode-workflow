import { describe, expect, test } from "bun:test"
import { detect, redact } from "../../src/security/secret"

describe("security.secret", () => {
  test("detects AWS keys", () => {
    expect(detect("AWS=AKIAABCDEFGHIJKLMNOP").some((item) => item.type === "aws")).toBe(true)
  })

  test("detects GitHub tokens", () => {
    expect(detect("GH=ghp_abcdefghijklmnopqrstuvwxyzABCDE").some((item) => item.type === "github")).toBe(true)
  })

  test("detects private key headers", () => {
    expect(detect("-----BEGIN OPENSSH PRIVATE KEY-----").some((item) => item.type === "private-key")).toBe(true)
  })

  test("detects JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue"
    expect(detect(jwt).some((item) => item.type === "jwt")).toBe(true)
  })

  test("detects Slack tokens", () => {
    expect(detect("SLACK=xoxb-1234567890-abcdefghi").some((item) => item.type === "slack")).toBe(true)
  })

  test("detects generic secret assignments", () => {
    expect(detect('api_key="sk_live_123456789abcdef"').some((item) => item.type === "generic")).toBe(true)
  })

  test("detects high entropy token-like strings", () => {
    const token = "P9sQ2wE7rT6yU1iO4pA8sD3fG5hJ0kLz"
    expect(detect(token).some((item) => item.type === "high-entropy")).toBe(true)
  })

  test("redacts findings without exposing raw secret values", () => {
    const raw = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    const findings = detect(`token=${raw}`)
    expect(JSON.stringify(findings)).not.toContain(raw)
    expect(redact(raw)).toBe("ghp_...wxyz")
  })
})
