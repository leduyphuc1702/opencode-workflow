import { describe, expect, test } from "bun:test"
import { isAllowedDomain } from "../../src/security/network"

describe("security.network", () => {
  test("allows exact and subdomain matches from the allow list", () => {
    expect(isAllowedDomain("https://example.com/docs", ["example.com"], [])).toBe(true)
    expect(isAllowedDomain("https://api.example.com/docs", ["example.com"], [])).toBe(true)
  })

  test("denies domains outside the allow list", () => {
    expect(isAllowedDomain("https://evil.test", ["example.com"], [])).toBe(false)
  })

  test("deny list wins over allow list", () => {
    expect(isAllowedDomain("https://api.example.com", ["example.com"], ["api.example.com"])).toBe(false)
  })

  test("supports wildcard allow entries", () => {
    expect(isAllowedDomain("https://anything.test", ["*"], [])).toBe(true)
    expect(isAllowedDomain("https://docs.example.com", ["*.example.com"], [])).toBe(true)
  })

  test("fails closed for invalid URLs and empty allow lists", () => {
    expect(isAllowedDomain("not a url", ["example.com"], [])).toBe(false)
    expect(isAllowedDomain("https://example.com", [], [])).toBe(false)
  })
})
