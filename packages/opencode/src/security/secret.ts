export type Finding = {
  type: string
  line: number
  redacted: string
}

const allowlist = ["test", "fixture", "example", "dummy", "placeholder", "sample"]

const patterns = [
  { type: "aws", regex: /AKIA[0-9A-Z]{16}/g },
  { type: "github", regex: /gh[pous]_[A-Za-z0-9_]{20,}/g },
  { type: "private-key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { type: "jwt", regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { type: "slack", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
]

const generic = /\b(?:api|secret|token|password)(?:[_-]?key)?\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{12,})["']?/gi
const tokenCandidate = /[A-Za-z0-9_./+=-]{20,}/g

export function detect(text: string): Finding[] {
  const findings: Finding[] = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (isAllowlisted(line)) continue
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern.regex)) {
        findings.push({ type: pattern.type, line: index + 1, redacted: redact(match[0]) })
      }
    }
    for (const match of line.matchAll(generic)) {
      if (!match[1]) continue
      findings.push({ type: "generic", line: index + 1, redacted: redact(match[1]) })
    }
    for (const match of line.matchAll(tokenCandidate)) {
      if (entropy(match[0]) < 4 || knownPrefix(match[0])) continue
      findings.push({ type: "high-entropy", line: index + 1, redacted: redact(match[0]) })
    }
  }
  return dedupe(findings)
}

export function redact(value: string): string {
  if (value.length <= 8) return "***"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

// Replace every detected secret substring in `text` with its redacted form so
// the result is safe to display/log. Used for permission metadata and prompts.
export function redactText(text: string): string {
  const raws = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (isAllowlisted(line)) continue
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern.regex)) raws.add(match[0])
    }
    for (const match of line.matchAll(generic)) {
      if (match[1]) raws.add(match[1])
    }
    for (const match of line.matchAll(tokenCandidate)) {
      if (entropy(match[0]) < 4 || knownPrefix(match[0])) continue
      raws.add(match[0])
    }
  }
  // Replace longer secrets first so a shorter match cannot partially mask a
  // longer one that contains it.
  return [...raws]
    .sort((a, b) => b.length - a.length)
    .reduce((acc, raw) => acc.split(raw).join(redact(raw)), text)
}

function entropy(value: string) {
  const counts = Array.from(value).reduce<Record<string, number>>((acc, char) => {
    acc[char] = (acc[char] ?? 0) + 1
    return acc
  }, {})
  return Object.values(counts).reduce((sum, count) => {
    const p = count / value.length
    return sum - p * Math.log2(p)
  }, 0)
}

function knownPrefix(value: string) {
  return ["http://", "https://", "file://"].some((prefix) => value.toLowerCase().startsWith(prefix))
}

function dedupe(findings: Finding[]) {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = `${finding.type}:${finding.line}:${finding.redacted}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isAllowlisted(text: string) {
  const lower = text.toLowerCase()
  return allowlist.some((item) => lower.includes(item))
}

export * as SecuritySecret from "./secret"
