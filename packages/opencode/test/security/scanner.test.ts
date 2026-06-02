import { describe, expect, test } from "bun:test"
import { scan } from "../../src/security/scanner"

describe("security.scanner", () => {
  test("detects eval usage", () => {
    expect(scan({ path: "src/app.ts", content: "eval(userInput)" }).some((item) => item.pattern === "eval")).toBe(true)
  })

  test("detects innerHTML assignment", () => {
    const result = scan({ path: "src/app.ts", content: "node.innerHTML = html" })
    expect(result.some((item) => item.pattern === "innerHTML assignment")).toBe(true)
  })

  test("detects child_process.exec", () => {
    const result = scan({ path: "src/app.ts", content: "child_process.exec(cmd)" })
    expect(result.some((item) => item.pattern === "child_process.exec")).toBe(true)
  })

  test("skips allowlisted contexts", () => {
    expect(scan({ path: "src/example.ts", content: "eval(userInput)" })).toEqual([])
    expect(scan({ path: "src/app.ts", content: "// sample eval(userInput)" })).toEqual([])
  })
})
