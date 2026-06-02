import { SecurityScanner } from "./scanner"
import { SecuritySecret } from "./secret"

export type AddedLine = {
  line: number
  text: string
}

export type DiffFile = {
  path: string
  addedLines: AddedLine[]
}

export type Finding = SecurityScanner.Finding & {
  path: string
  line: number
  redacted?: string
}

export function parseDiffFiles(diffText: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | undefined
  let nextLine = 0
  let inHunk = false

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = undefined
      inHunk = false
      continue
    }

    const nextPath = parseNewPath(line)
    if (nextPath) {
      current = { path: nextPath, addedLines: [] }
      files.push(current)
      inHunk = false
      continue
    }

    const hunkStart = parseHunkStart(line)
    if (hunkStart !== undefined) {
      nextLine = hunkStart
      inHunk = true
      continue
    }

    if (!inHunk || !current) continue
    if (line.startsWith("\\ No newline at end of file")) continue
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedLines.push({ line: nextLine, text: line.slice(1) })
      nextLine++
      continue
    }
    if (line.startsWith("-") && !line.startsWith("---")) continue
    if (line.startsWith(" ")) nextLine++
  }

  return files.filter((file) => file.addedLines.length > 0)
}

export function reviewDiff(diffText: string): Finding[] {
  return parseDiffFiles(diffText).flatMap((file) => {
    const content = file.addedLines.map((line) => line.text).join("\n")
    const lineMap = new Map(file.addedLines.map((line, index) => [index + 1, line.line]))
    const secrets = SecuritySecret.detect(content)

    return SecurityScanner.scan({ path: file.path, content }).map((finding) => {
      const secret = secrets.find((item) => item.line === finding.line && `secret:${item.type}` === finding.pattern)
      return {
        ...finding,
        path: file.path,
        line: lineMap.get(finding.line) ?? finding.line,
        ...(secret ? { redacted: secret.redacted } : {}),
      }
    })
  })
}

export function summarizeReview(findings: readonly Finding[]) {
  if (findings.length === 0) return "Security review: no findings"
  return findings
    .map((finding) =>
      [
        `Security review: ${oneLine(finding.path)}:${finding.line}`,
        `${finding.level}${finding.advisory ? "/advisory" : "/blocking"}`,
        oneLine(finding.pattern),
        finding.redacted ? `redacted=${oneLine(finding.redacted)}` : undefined,
      ]
        .filter((item): item is string => Boolean(item))
        .join("; "),
    )
    .join("\n")
}

function parseNewPath(line: string) {
  if (!line.startsWith("+++ ")) return
  const raw = line.slice(4).split("\t")[0]?.trim()
  if (!raw || raw === "/dev/null") return
  return raw.startsWith("b/") ? raw.slice(2) : raw
}

function parseHunkStart(line: string) {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (!match?.[1]) return
  return Number(match[1])
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export * as SecurityReview from "./review"
