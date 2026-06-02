import path from "path"
import { maxLevel, type RiskLevel } from "./risk"

export type Decision = "allow" | "ask" | "deny"

type Compound = {
  parts: string[]
  ambiguous: boolean
}

type Words = {
  words: string[]
  ambiguous: boolean
}

const shells = new Set(["bash", "sh", "zsh"])
const simpleWrappers = new Set(["sudo", "nohup", "command"])
const lowCommands = new Set(["cat", "echo", "grep", "ls", "pwd", "rg", "true", "which"])
const mediumCommands = new Set(["chmod", "chown", "cp", "mkdir", "mv", "sed", "tee", "touch"])

export function splitCompound(cmd: string): string[] {
  return compound(cmd).parts
}

export function stripWrappers(sub: string): string {
  const parsed = shellWords(sub)
  if (parsed.ambiguous) return sub.trim()
  return stripWrapperWords(parsed.words).join(" ")
}

export function analyze(command: string): { level: RiskLevel; decision: Decision; reasons: string[] } {
  const raw = command.trim()
  if (!raw) return deny("empty or unparseable command")
  if (exfilExec(raw)) return { level: "irreversible", decision: "deny", reasons: ["pipes downloaded or decoded content into an interpreter"] }

  const pieces = compound(raw)
  if (pieces.ambiguous || pieces.parts.length === 0) return deny("ambiguous compound command")

  const results = pieces.parts.map(analyzeSubcommand)
  return {
    level: maxLevel(results.map((item) => item.level)),
    decision: combineDecision(results.map((item) => item.decision)),
    reasons: results.flatMap((item) => item.reasons),
  }
}

function analyzeSubcommand(command: string): { level: RiskLevel; decision: Decision; reasons: string[] } {
  const payload = shellInlinePayload(command)
  if (payload !== undefined) return payload === null ? deny("ambiguous shell wrapper payload") : analyze(payload)

  const stripped = stripWrappers(command)
  const parsed = shellWords(stripped)
  if (parsed.ambiguous || parsed.words.length === 0) return deny("empty or unparseable subcommand")

  const words = parsed.words
  const name = base(words[0])
  if (!name) return deny("missing command name")
  if (destructive(words, name)) return { level: "irreversible", decision: "deny", reasons: [`destructive command: ${name}`] }
  if (prodInfra(words, name)) return { level: "irreversible", decision: "deny", reasons: [`production or infrastructure command: ${name}`] }
  if (sensitive(words, name)) return { level: "high", decision: "ask", reasons: [`sensitive command: ${name}`] }
  if (safeRead(words, name)) return { level: "low", decision: "allow", reasons: [`read-only command: ${name}`] }
  if (mediumCommands.has(name)) return { level: "medium", decision: "ask", reasons: [`filesystem mutation command: ${name}`] }
  return { level: "medium", decision: "ask", reasons: [`unrecognized command: ${name}`] }
}

function compound(command: string): Compound {
  const parts: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  let escaped = false
  let ambiguous = false
  let endedWithSeparator = false

  const push = () => {
    const trimmed = current.trim()
    if (!trimmed) ambiguous = true
    else parts.push(trimmed)
    current = ""
    endedWithSeparator = true
  }

  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    const next = command[i + 1]
    if (escaped) {
      current += char
      escaped = false
      endedWithSeparator = false
      continue
    }
    if (char === "\\") {
      current += char
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      endedWithSeparator = false
      continue
    }
    if (char === "\n" || char === ";") {
      push()
      continue
    }
    if ((char === "&" && next === "&") || (char === "|" && (next === "|" || next === "&"))) {
      push()
      i++
      continue
    }
    if (char === "|") {
      push()
      continue
    }
    if (!/\s/.test(char)) endedWithSeparator = false
    current += char
  }

  if (quote || escaped || endedWithSeparator) ambiguous = true
  if (current.trim()) parts.push(current.trim())
  return { parts, ambiguous }
}

function shellWords(command: string): Words {
  const words: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  let escaped = false

  const push = () => {
    if (!current) return
    words.push(current)
    current = ""
  }

  for (const char of command) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      push()
      continue
    }
    current += char
  }

  push()
  return { words, ambiguous: Boolean(quote || escaped) }
}

function stripWrapperWords(words: string[]): string[] {
  if (words.length === 0) return words
  const name = base(words[0])
  if (name === "env") return stripWrapperWords(stripEnv(words.slice(1)))
  if (simpleWrappers.has(name)) return stripWrapperWords(stripLeadingOptions(words.slice(1)))
  if (name === "xargs") return stripWrapperWords(stripLeadingOptions(words.slice(1)))
  if (shells.has(name)) return stripShell(words)
  return words
}

function stripShell(words: string[]) {
  const index = words.findIndex((item) => item.startsWith("-") && item.includes("c"))
  if (index === -1 || !words[index + 1]) return []
  return stripWrapperWords(shellWords(words[index + 1]).words)
}

// If `command` is a shell wrapper invoking an inline `-c` payload, return that
// payload so the caller can re-run full compound analysis on it. Returns null
// when the wrapper is present but the payload cannot be parsed (fail closed),
// and undefined when this is not a shell wrapper. Operates on the tokenized
// word array so the quoted payload word is preserved intact.
function shellInlinePayload(command: string): string | null | undefined {
  const parsed = shellWords(command)
  if (parsed.ambiguous || parsed.words.length === 0) return undefined
  const words = base(parsed.words[0]) === "env" ? stripEnv(parsed.words.slice(1)) : parsed.words
  if (words.length === 0 || !shells.has(base(words[0]))) return undefined
  const index = words.findIndex((item) => item.startsWith("-") && !item.startsWith("--") && item.includes("c"))
  if (index === -1) return undefined
  const payload = words[index + 1]
  if (payload === undefined) return null
  return payload
}

function stripEnv(words: string[]) {
  const index = words.findIndex((item) => !item.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(item))
  return index === -1 ? [] : words.slice(index)
}

function stripLeadingOptions(words: string[]) {
  const index = words.findIndex((item) => !item.startsWith("-"))
  return index === -1 ? [] : words.slice(index)
}

function base(command: string) {
  return path.basename(command).toLowerCase()
}

function hasFlag(words: string[], short: string, long: string) {
  return words.slice(1).some((word) => word === long || word === short || (word.startsWith("-") && !word.startsWith("--") && word.includes(short.slice(1))))
}

function destructive(words: string[], name: string) {
  if (name === "rm") return hasFlag(words, "-r", "--recursive") && hasFlag(words, "-f", "--force")
  if (name === "find") return words.includes("-delete") || words.includes("-exec")
  if (name !== "git") return false
  const sub = words[1]
  if (sub === "push") return words.includes("--force") || words.includes("-f")
  if (sub === "reset") return words.includes("--hard")
  if (sub === "clean") return hasFlag(words, "-f", "--force") && hasFlag(words, "-d", "--directories")
  return false
}

function prodInfra(words: string[], name: string) {
  if (name === "kubectl" && words[1] === "delete") return true
  if (name === "terraform" && ["apply", "destroy"].includes(words[1] ?? "")) return true
  if (name === "aws" && words.some((item) => ["delete", "delete-object", "delete-bucket", "rm"].includes(item))) return true
  return words.some((item) => /^(migrate|migration|release)$/.test(item)) || deploysProd(words)
}

function deploysProd(words: string[]) {
  const text = words.join(" ").toLowerCase()
  return text.includes("deploy") && /\b(prod|production)\b/.test(text)
}

function sensitive(words: string[], name: string) {
  const text = words.join(" ").toLowerCase()
  return (
    ["psql", "mysql", "sqlite3"].includes(name) ||
    ["auth", "permission", "payment", "public-api", "public_api"].some((term) => text.includes(term)) ||
    (name === "aws" && /\b(iam|sts|kms)\b/.test(text))
  )
}

function safeRead(words: string[], name: string) {
  if (lowCommands.has(name)) return true
  if (name === "git") return ["branch", "diff", "log", "show", "status"].includes(words[1] ?? "")
  if (name === "find") return !destructive(words, name)
  return false
}

function exfilExec(command: string) {
  return /\b(?:curl|wget)\b[^|]*\|\s*(?:bash|sh|zsh|fish|python|perl|ruby|node)\b/i.test(command) || /\bbase64\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/i.test(command)
}

function deny(reason: string) {
  return { level: "irreversible" as const, decision: "deny" as const, reasons: [reason] }
}

function combineDecision(decisions: Decision[]) {
  if (decisions.includes("deny")) return "deny"
  if (decisions.includes("ask")) return "ask"
  return "allow"
}

export * as SecurityCommand from "./command"
