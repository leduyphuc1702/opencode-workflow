import type { Decision } from "./command"
import { maxLevel, type RiskLevel } from "./risk"
import type { Finding as SecretFinding } from "./secret"

export type Secret = Pick<SecretFinding, "type" | "line" | "redacted">

export type Finding = {
  level: RiskLevel
  decision?: Decision
  reasons: string[]
  secrets: Secret[]
}

type FindingInput = {
  level: RiskLevel
  decision?: Decision
  reasons: readonly string[]
  secrets: readonly Secret[]
}

type Analysis = {
  level: RiskLevel
  decision?: Decision
  reasons: readonly string[]
}

export function build(analysis: Analysis, secrets: readonly Secret[] = []): Finding {
  return {
    level: secrets.length > 0 ? maxLevel([analysis.level, "high"]) : analysis.level,
    decision: analysis.decision,
    reasons: [...analysis.reasons],
    secrets: secrets.map((secret) => ({ type: secret.type, line: secret.line, redacted: secret.redacted })),
  }
}

export function summarize(finding: FindingInput): string {
  if (isEmpty(finding)) return "Security: none"
  const decision = finding.decision ? `/${finding.decision}` : ""
  const reasons = finding.reasons.map(oneLine).filter(Boolean).join("; ")
  const secrets = finding.secrets.map(
    (secret) => `${oneLine(secret.type)} line ${secret.line}: ${oneLine(secret.redacted)}`,
  )
  return [
    `Security: ${finding.level}${decision}`,
    reasons ? `reasons: ${reasons}` : undefined,
    secrets.length > 0 ? `secrets: ${secrets.join("; ")}` : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .join("; ")
}

export function isEmpty(finding: FindingInput | undefined) {
  return !finding || (finding.reasons.length === 0 && finding.secrets.length === 0)
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export * as SecurityFinding from "./finding"
