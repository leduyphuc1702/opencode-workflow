import { describe, expect, test } from "bun:test"
import path from "path"

const promptDir = path.resolve(import.meta.dir, "../../src/agent/prompt")
const workflowPrompts = [
  "plan-agent-workflow.txt",
  "plan-reviewer-workflow.txt",
  "implementation-agent-workflow.txt",
  "code-reviewer-workflow.txt",
]
const solPrompts = [
  "backend-explorer-workflow.txt",
  "frontend-explorer-workflow.txt",
  "research-agent-workflow.txt",
  "plan-agent-workflow.txt",
  "plan-reviewer-workflow.txt",
  "plan-finalizer-workflow.txt",
  "backend-agent-workflow.txt",
  "frontend-agent-workflow.txt",
  "implementation-agent-workflow.txt",
  "code-reviewer-workflow.txt",
  "skillopt-agent.txt",
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

  test("SOL sub-agent prompts record artifacts and never ask users directly", async () => {
    for (const file of solPrompts) {
      const prompt = await Bun.file(path.join(promptDir, file)).text()

      expect(prompt).toContain("workflow_record_artifact")
      expect(prompt).toContain("workflow_break")
      expect(prompt.toLowerCase()).toContain("do not ask")
    }
  })

  test("orchestrator prompt requires full SOL order and final approvals", async () => {
    const prompt = await Bun.file(path.join(promptDir, "orchestrator-workflow.txt")).text()

    expect(prompt).toContain("backend-explorer")
    expect(prompt).toContain("frontend-explorer")
    expect(prompt).toContain("research-agent")
    expect(prompt).toContain("workflow_approve_plan")
    expect(prompt).toContain("workflow_approve_done")
    expect(prompt).toContain("workflow_approve_commit")
    expect(prompt).toContain("manual test guidance")
    expect(prompt).toContain("Do not run")
  })

  test("orchestrator prompt requires constructive clarification before plan-agent", async () => {
    const prompt = await Bun.file(path.join(promptDir, "orchestrator-workflow.txt")).text()
    const planAgent = prompt.indexOf("Run plan-agent")

    expect(prompt).toContain("workflow_clarify_scope")
    expect(prompt).toContain("clarification_checkpoint")
    expect(prompt).toContain("constructive clarification")
    expect(prompt).toContain("options/tradeoffs")
    expect(prompt).toContain("user's choice")
    expect(prompt).toContain("focused research")
    expect(prompt).toContain("follow-up settings/constraints")
    expect(prompt).toContain("readyToPlan true")
    expect(prompt.indexOf("constructive clarification")).toBeLessThan(planAgent)
    expect(prompt.indexOf("workflow_clarify_scope")).toBeLessThan(planAgent)
    expect(prompt.indexOf("clarification_checkpoint")).toBeLessThan(planAgent)
  })

  test("research agent prompt requires DuckDuckGo fallback for missing websearch", async () => {
    const prompt = await Bun.file(path.join(promptDir, "research-agent-workflow.txt")).text()

    expect(prompt).toContain("DuckDuckGo MCP shell fallback")
    expect(prompt).toContain("mcporter call --stdio 'uvx duckduckgo-mcp-server' search")
    expect(prompt).toContain("mcporter call --stdio 'uvx duckduckgo-mcp-server' fetch_content")
    expect(prompt).toContain("If github_skill_search fails")
  })
})
