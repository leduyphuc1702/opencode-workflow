import { describe, expect, test } from "bun:test"
import path from "path"

const promptDir = path.resolve(import.meta.dir, "../../src/agent/prompt")
const workflowPrompts = [
  "plan-agent-workflow.txt",
  "plan-reviewer-workflow.txt",
  "implementation-agent-workflow.txt",
  "code-reviewer-workflow.txt",
]

describe("workflow.agent-contract", () => {
  test("workflow sub-agent prompts carry the four operating principles", async () => {
    for (const file of workflowPrompts) {
      const prompt = await Bun.file(path.join(promptDir, file)).text()

      expect(prompt).toContain("Think Before Coding")
      expect(prompt).toContain("Simplicity First")
      expect(prompt).toContain("Surgical Changes")
      expect(prompt).toContain("Goal-Driven Execution")
    }
  })

  test("plan reviewer requires a concrete artifact before review", async () => {
    const prompt = await Bun.file(path.join(promptDir, "plan-reviewer-workflow.txt")).text()

    expect(prompt).toContain("Review only a real PlanDraft")
    expect(prompt).toContain("If no artifact is provided, call workflow_break")
  })
})
