import path from "path"
import { detect } from "./secret"
import type { RiskLevel } from "./risk"

export type Finding = {
  pattern: string
  line: number
  level: RiskLevel
  advisory: boolean
}

const allowlist = ["test", "fixture", "example", "dummy", "placeholder", "sample"]

const patterns: Array<{ pattern: string; regex: RegExp; level: RiskLevel }> = [
  { pattern: "eval", regex: /\beval\s*\(/, level: "high" },
  { pattern: "new Function", regex: /\bnew\s+Function\s*\(/, level: "high" },
  { pattern: "child_process.exec", regex: /\bchild_process\s*\.\s*exec\s*\(/, level: "high" },
  { pattern: "innerHTML assignment", regex: /\.\s*innerHTML\s*=/, level: "high" },
  { pattern: "dangerouslySetInnerHTML", regex: /\bdangerouslySetInnerHTML\b/, level: "high" },
  { pattern: "unsafe yaml load", regex: /\byaml\s*\.\s*load\s*\(/, level: "high" },
  { pattern: "pickle.loads", regex: /\bpickle\s*\.\s*loads\s*\(/, level: "high" },
  { pattern: "weak crypto md5", regex: /\bcreateHash\s*\(\s*["']md5["']\s*\)/i, level: "medium" },
  { pattern: "weak crypto sha1", regex: /\bcreateHash\s*\(\s*["']sha1["']\s*\)/i, level: "medium" },
  { pattern: "weak crypto sha1", regex: /\bdigest\s*\(\s*["']SHA-?1["']\s*\)/i, level: "medium" },
]

export function scan(input: { path: string; content: string }): Finding[] {
  if (isAllowlisted(input.path)) return []
  const findings: Finding[] = []
  if (protectedWorkflow(input.path)) {
    findings.push({ pattern: "protected workflow config", line: 1, level: "high", advisory: false })
  }

  for (const secret of detect(input.content)) {
    findings.push({ pattern: `secret:${secret.type}`, line: secret.line, level: "high", advisory: false })
  }

  for (const [index, line] of input.content.split(/\r?\n/).entries()) {
    if (isAllowlisted(line)) continue
    findings.push(
      ...patterns
        .filter((item) => item.regex.test(line))
        .map((item) => ({ pattern: item.pattern, line: index + 1, level: item.level, advisory: true })),
    )
  }

  return findings
}

function protectedWorkflow(file: string) {
  const normalized = file.replaceAll("\\", "/").toLowerCase()
  const name = path.basename(normalized)
  return (
    normalized.includes("/.github/workflows/") ||
    normalized.startsWith(".github/workflows/") ||
    normalized.includes("/.github/actions/") ||
    normalized.startsWith(".github/actions/") ||
    normalized.endsWith("/.gitlab-ci.yml") ||
    normalized === ".gitlab-ci.yml" ||
    normalized.endsWith("/.gitlab-ci.yaml") ||
    normalized === ".gitlab-ci.yaml" ||
    normalized.endsWith("/circleci/config.yml") ||
    normalized === "circleci/config.yml" ||
    ["action.yml", "action.yaml", "azure-pipelines.yml", "azure-pipelines.yaml"].includes(name)
  )
}

function isAllowlisted(text: string) {
  const lower = text.toLowerCase()
  return allowlist.some((item) => lower.includes(item))
}

export * as SecurityScanner from "./scanner"
