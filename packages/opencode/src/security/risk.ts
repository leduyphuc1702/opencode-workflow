import path from "path"

export type RiskLevel = "low" | "medium" | "high" | "irreversible"

const order: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  irreversible: 3,
}

const readTools = new Set(["read", "glob", "grep", "list"])
const writeTools = new Set(["edit", "write", "patch", "apply_patch"])
const sensitiveTerms = ["auth", "permission", "payment", "db", "database", "public-api", "public_api"]

export function classify(input: { tool: string; command?: string; paths?: string[] }): {
  level: RiskLevel
  reasons: string[]
} {
  const reasons: string[] = []
  const levels: RiskLevel[] = []
  const tool = input.tool.toLowerCase()
  const command = input.command?.toLowerCase() ?? ""
  const paths = input.paths ?? []

  if (readTools.has(tool)) {
    levels.push("low")
    reasons.push("read-only tool")
  }

  if (writeTools.has(tool) && paths.every((item) => insideCwd(item))) {
    levels.push("medium")
    reasons.push("workspace edit/write")
  }

  if ([tool, command, ...paths.map((item) => item.toLowerCase())].some((item) => sensitiveTerms.some((term) => item.includes(term)))) {
    levels.push("high")
    reasons.push("sensitive domain")
  }

  if (paths.some((item) => !insideCwd(item))) {
    levels.push("high")
    reasons.push("path outside current workspace")
  }

  if (irreversibleCommand(command)) {
    levels.push("irreversible")
    reasons.push("irreversible command")
  }

  if (levels.length === 0) {
    levels.push("medium")
    reasons.push("tool changes runtime state")
  }

  return { level: maxLevel(levels), reasons }
}

export function maxLevel(levels: RiskLevel[]) {
  return levels.reduce<RiskLevel>((max, item) => (order[item] > order[max] ? item : max), "low")
}

function insideCwd(input: string) {
  const relative = path.relative(process.cwd(), path.resolve(process.cwd(), input))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function irreversibleCommand(command: string) {
  return [
    /\brm\s+-[a-z]*r[a-z]*f\b/,
    /\brm\s+-[a-z]*f[a-z]*r\b/,
    /\bfind\b[\s\S]*(?:-delete|-exec)\b/,
    /\bgit\s+push\b[\s\S]*(?:--force|-f)\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\s+-[a-z]*f[a-z]*d\b/,
    /\b(?:prod|production)\b[\s\S]*\bdeploy\b|\bdeploy\b[\s\S]*\b(?:prod|production)\b/,
    /\b(?:migrate|migration|release)\b/,
  ].some((pattern) => pattern.test(command))
}

export * as SecurityRisk from "./risk"
