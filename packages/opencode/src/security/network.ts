export function isAllowedDomain(url: string, allow: readonly string[] = [], deny: readonly string[] = []) {
  const host = hostname(url)
  if (!host) return false
  if (deny.some((domain) => matches(host, domain))) return false
  if (allow.length === 0) return false
  return allow.some((domain) => matches(host, domain))
}

function matches(host: string, pattern: string) {
  const domain = normalizeDomain(pattern)
  if (!domain) return false
  if (domain === "*") return true
  if (domain.startsWith("*.")) return matchesSuffix(host, domain.slice(2))
  return matchesSuffix(host, domain)
}

function matchesSuffix(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`)
}

function hostname(url: string) {
  if (!URL.canParse(url)) return
  return new URL(url).hostname.toLowerCase()
}

function normalizeDomain(input: string) {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return
  if (trimmed === "*") return trimmed
  if (URL.canParse(trimmed)) return new URL(trimmed).hostname.toLowerCase()
  return trimmed.replace(/^\*\./, "*.").replace(/:\d+$/, "")
}

export * as SecurityNetwork from "./network"
