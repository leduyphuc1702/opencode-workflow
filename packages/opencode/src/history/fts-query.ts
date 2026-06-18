// Build an FTS5 MATCH expression from a free-form user query.
// Tokenize on non-word boundaries (preserving CJK / Unicode letters and digits),
// wrap each token in phrase quotes, AND-join. Returns null when no usable tokens.
//
// Independent copy from memory/fts-query.ts so the two modules can evolve apart.
export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? []
  if (tokens.length === 0) return null
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`)
  return quoted.join(" AND ")
}

// Extract inline `field:value` prefixes (e.g. "kind:tool_error timeout") so a
// single free-form query string can carry structured filters. Independent copy
// from memory/fts-query.ts so the two modules can evolve apart. Idea borrowed
// from vibervn-context-engine's field-qualified search; fields map to our
// existing FTS filter columns. Unknown / non-allowed tokens stay in `rest`.
export function parseFields(
  raw: string,
  allowed: ReadonlyArray<string>,
): { fields: Record<string, string[]>; rest: string } {
  const allow = new Set(allowed.map((a) => a.toLowerCase()))
  const fields: Record<string, string[]> = {}
  const rest: string[] = []
  for (const tok of raw.split(/\s+/)) {
    if (!tok) continue
    const m = tok.match(/^([A-Za-z_]+):(.+)$/)
    if (m && allow.has(m[1].toLowerCase())) {
      const key = m[1].toLowerCase()
      ;(fields[key] ??= []).push(m[2])
    } else {
      rest.push(tok)
    }
  }
  return { fields, rest: rest.join(" ") }
}
