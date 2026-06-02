import { describe, expect, test } from "bun:test"
import path from "path"
import { classify } from "../../src/security/risk"

describe("security.risk", () => {
  test("classifies read tools as low", () => {
    expect(classify({ tool: "read", paths: ["src/index.ts"] }).level).toBe("low")
  })

  test("classifies workspace writes as medium", () => {
    expect(classify({ tool: "write", paths: [path.join(process.cwd(), "src/index.ts")] }).level).toBe("medium")
  })

  test("classifies sensitive domains and external paths as high", () => {
    expect(classify({ tool: "auth", command: "update permission" }).level).toBe("high")
    expect(classify({ tool: "write", paths: [path.resolve(process.cwd(), "..", "outside.txt")] }).level).toBe("high")
  })

  test("classifies destructive commands as irreversible", () => {
    expect(classify({ tool: "bash", command: "rm -rf /tmp/prod" }).level).toBe("irreversible")
    expect(classify({ tool: "bash", command: "bun run migrate" }).level).toBe("irreversible")
  })
})
