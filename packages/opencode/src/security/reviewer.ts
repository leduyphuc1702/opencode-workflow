import { parseDiffFiles, reviewDiff, summarizeReview } from "./review"
import { SecuritySecret } from "./secret"

export const MAX_REVIEW_PASSES = 1

export type ReviewSeverity = "low" | "medium" | "high" | "critical"

export type ParsedFinding = {
  severity: ReviewSeverity
  title: string
  file?: string
  line?: number
}

export function buildReviewPrompt(diffText: string) {
  return [
    "You are a fresh security reviewer for an opencode commit/push gate.",
    `Run at most ${MAX_REVIEW_PASSES} advisory review pass. Do not block execution or request tool access.`,
    "Focus on high-confidence exploitable issues in the added lines. Ignore style-only concerns.",
    "Output only bullets in this format: - [severity] file:line - title | evidence | recommendation",
    "Deterministic pre-scan findings:",
    summarizeReview(reviewDiff(diffText)),
    "Redacted added-line diff:",
    renderAddedLines(diffText),
  ].join("\n\n")
}

export function parseReviewResult(output: string): ParsedFinding[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*-\s*\[(low|medium|high|critical)\]\s*(?:(\S+?)(?::(\d+))?\s+-\s+)?(.+?)\s*$/i.exec(line)
    const severity = reviewSeverity(match?.[1])
    if (!match || !severity) return []
    const parsedLine = match[3] ? Number(match[3]) : undefined
    return [
      {
        severity,
        title: match[4]?.trim() ?? "",
        ...(match[2] ? { file: match[2] } : {}),
        ...(parsedLine === undefined ? {} : { line: parsedLine }),
      },
    ]
  })
}

export function gateHint() {
  return `model review hook enabled: build a redacted reviewer prompt with SecurityReviewer.buildReviewPrompt(diffText); max ${MAX_REVIEW_PASSES} advisory pass`
}

function renderAddedLines(diffText: string) {
  const files = parseDiffFiles(diffText)
  if (files.length === 0) return "No added lines."
  return files
    .map((file) => [`--- ${file.path}`, ...file.addedLines.map((line) => `${line.line}: ${redactLine(line.text)}`)].join("\n"))
    .join("\n\n")
}

function redactLine(line: string) {
  const secrets = SecuritySecret.detect(line)
  if (secrets.length === 0) return line
  return `[redacted secret line: ${secrets.map((secret) => `${secret.type} ${secret.redacted}`).join(", ")}]`
}

function reviewSeverity(value: string | undefined): ReviewSeverity | undefined {
  switch (value?.toLowerCase()) {
    case "low":
      return "low"
    case "medium":
      return "medium"
    case "high":
      return "high"
    case "critical":
      return "critical"
  }
}

export * as SecurityReviewer from "./reviewer"
