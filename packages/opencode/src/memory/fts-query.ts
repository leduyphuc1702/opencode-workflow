// Build an FTS5 MATCH expression from a free-form user query.
//
// FTS5's MATCH grammar has its own operators and special characters
// (`"`, `(`, `)`, `*`, `:`, `^`, `-`, `.`, `{`, `}`). Passing a raw user
// string with any of these crashes the parser. Wrapping each token as a
// phrase and joining avoids the crash; OR-join keeps recall high (see
// below).
//
// Ported from openclaw's extensions/memory-core/src/memory/hybrid.ts:30.
// We tokenize via a Unicode regex that picks contiguous runs of letters,
// numbers, and underscore (everything else becomes a separator), wrap each
// token in phrase quotes, and OR-join. Phrase quotes turn each token into
// a literal-word search that no longer cares about FTS5 special chars.
//
// OR (not AND): AND-join required EVERY query word to appear in a document,
// so a single descriptive word the user added that wasn't in the stored
// text (e.g. "postgres database port 5433" — "database" absent) zeroed the
// whole query even when 6/7 tokens matched. Empirically (80-doc real
// memory) AND returned 0 results for nearly all multi-word queries, even
// 2-word ones like "permission deadlock". OR lets BM25 rank by how many /
// how rare the matched tokens are; the caller applies a score floor to drop
// common-word-only noise (see service.ts searchScoreFloor).
//
// \\p{L} includes CJK letters (added in openclaw PR #20767 for CJK recall).
//
// Returns null when no usable tokens are extracted. Callers should treat
// that as "empty query, no results" without sending the query to SQL.
export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? []
  if (tokens.length === 0) return null
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`)
  return quoted.join(" OR ")
}

// Extract inline `field:value` prefixes (e.g. "type:checkpoint deadlock") so a
// single free-form query string can carry structured filters. Idea borrowed
// from vibervn-context-engine's field-qualified search; here the fields map to
// our existing FTS filter columns instead of code symbols.
//
// Only tokens whose field is in `allowed` are captured; everything else (plain
// terms, and unknown `host:port`-style tokens like "postgres://h") stays in
// `rest` verbatim, to be handed to buildFtsQuery. A field may repeat
// ("kind:a kind:b") -> multiple values. Values cannot contain whitespace.
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
