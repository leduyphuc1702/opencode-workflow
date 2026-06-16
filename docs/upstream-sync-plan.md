# Upstream Sync Plan — anomalyco/opencode → fork

**Goal:** Inherit the "essence" (isolated bugfixes + new features) of upstream `anomalyco/opencode`
into this fork, skipping changes where the fork's mod is already better.

**Branch:** `sync/upstream-anomalyco` (based on `dev`). FF-merge to `dev` when verified.

## Divergence (as of fork point 748fcb7eb, 2026-05-25)

- Fork behind upstream/dev by **790 commits** (3 weeks). Fork ahead by 30 (the mods).
- Versioning is independent (fork = 1.15.x, upstream tags = v1.2.x) → align by git graph, not version.

## Scope

In-scope packages (shipped product): `opencode, core, llm, ui, sdk, plugin, desktop`.
Out-of-scope (don't port into): `app, console, web, storybook, docs, enterprise, slack, function`.

- In-scope deduped commit union: **493**
- In-scope high-value (feat/fix/perf): **265**
  - **Class A — portable isolated bugfixes/features: 190** ← THIS ROUND
  - **Class B — in-flight v2 architecture migration: 75** ← DEFERRED (see below)

## Class B = DEFERRED (do NOT cherry-pick piecemeal)

Upstream is mid-migration on interdependent streams. Cherry-picking these individually breaks.
Adopt later as a deliberate, separate migration if desired:
`v2 session runtime`, `location layer`, `project copies / worktrees / moving sessions`,
`acp-next`, `fff file search`, `native API`, `command/skill registry`, `session metadata migration`.

## Protected mod areas (DO NOT let upstream clobber — keep fork's version on conflict)

1. Security guidance layer (risk taxonomy, fail-closed shell, secret scan, permission modes, sandbox, diff review)
2. 9router provider (support, responses routing, model metadata, null-event handling)
3. codegraph + research tools + workflow/SOL orchestration
4. design-taste-frontend skill + frontend image-model propagation
5. subagent_model_overrides in task tool path
6. Commit-approval / staged-diff flow + "allow direct review fixes"
7. Update mechanism → `leduyphuc1702/opencode-workflow` (electron-updater / core update endpoint)
8. Desktop open-computer-use bundling
9. Post-explore clarification checkpoint + variant propagation to subagents

## Verification per batch

- `cd packages/opencode && bun typecheck` (baseline = PASS at HEAD)
- `bun test test/config/config.test.ts` + targeted tests for touched subsystem
- Each cherry-pick keeps `-x` provenance line.

## Batch plan & progress

| # | Batch | ~Commits | Risk | Status |
|---|-------|----------|------|--------|
| 1a | Providers & models (reasoning, new models, provider bumps) | ~22 | low | DONE — 19 landed, 9 deferred |
| 1b | New providers + transport headers (Snowflake, X-Session-Id, item-id) | ~6 | med | todo |
| 1c | OpenAI websocket transport cluster | ~8 | med (9router responses overlap) | todo |
| 2 | MCP robustness | 12 | low | DONE — 8 landed, 13 deferred (MCP module diverged → reconciliation pass) |
| 3 | LSP / snapshot / config / server / session (non-v2) | ~10 | low | todo |
| 4 | Plugin / sdk / http-recorder | ~5 | low | todo |
| 5 | TUI (packages/opencode/.../tui) isolated fixes | ~31 | med | DONE — 25 landed, 6 deferred/reverted |
| 6 | Desktop (CAREFUL: protect updater→fork repo + OCU) | 8 | high | todo |
| 7 | ACP (existing acp only, not acp-next) | ~9 | med | todo |
| 8 | opencode core misc (edit safety, SSE retry, shell race, ...) | ~40 | high (mod lives here) | todo |
| 9 | app co-touch commits | ~10 | n/a | mostly skip |

## Deferred (revisit in dedicated passes)

**Dependency-bump pass** (bump dep + single `bun install`):
- #30463 Gemini replay patch — needs `@ai-sdk/google` 3.0.63→3.0.73
- #30464 bump bedrock + Mantle support (aws-bedrock SDK)
- #30800 bump `@openrouter/ai-sdk-provider` 2.9.0
- #31611 Anthropic fallback responses (dep)

**Bedrock Mantle feature chain** (do together): #30464 + #31001 (honor Mantle config; needs `selectBedrockMantleLanguageModel`).

**Niche / skipped**: #29901 + #31700 Snowflake Cortex provider (conflicts fork provider registry `provider/index`).

**V2-entangled (Class B-ish)**: #31004 scope Vertex transforms (fork uses `provider.endpoint`, upstream renamed to `provider.api`).

**SDK-regen pass** (apply source + regenerate SDK types/openapi): #31745 content-filter finish reason.

**Resolution notes**:
- #30973 gate reasoning summaries: took upstream source gating; preserved fork's `9router forceReasoning`; dropped upstream's V2-shaped Bedrock Mantle test.
- f011d7712 normalize tool schemas: kept the tool-schema test; dropped bundled system-update test (uses `Message.system` absent in fork).

## Progress log

- 2026-06-16: Recon complete. Restored wiped `packages/` (approved). Branch created. Deps installed. Baseline typecheck PASS. Triage done.
- 2026-06-16: **Batch 1a DONE** — 19 provider/model commits landed (incl. Claude Fable reasoning, MiniMax M3, Cohere North, adaptive reasoning opus 4.7+). opencode+llm typecheck PASS; transform 258/258, openai-responses 47/47 tests pass. 9 deferred (see above).
- 2026-06-16: **Batch 2 (MCP) DONE** — 8 landed (disconnect dynamic servers, serialize auth, non-interactive add, respect capabilities, abort signal, connection statuses, preserve auth headers, SDK protocol version) + 1 fixup (ConfigMCPV1→ConfigMCP). 13 deferred: fork's MCP module diverged (no `paginate`, `ConfigMCP` vs upstream `ConfigMCPV1`, tolerant-schema, capability-gated defs) → needs a holistic **MCP reconciliation** pass. opencode typecheck PASS, mcp tests 49/49.
- 2026-06-16: **Batch 3 (TUI) ~DONE** — 25 landed, 5 deferred (conflict), 1 reverted (#30935 diff hunk nav needs `getHunkRowOffsets`/test-renderer infra). Fork TUI lives in `packages/opencode/src/cli/cmd/tui`. opencode+ui typecheck PASS.

## Key structural findings

- Upstream added NEW packages the fork lacks: `cli, server, tui, stats, effect-sqlite-node`. `packages/tui` = new v2 TUI; fork's TUI is still under `packages/opencode/src/cli/cmd/tui` + `packages/ui`. Skip commits that touch `packages/tui`.
- Fork refactored provider registry to `packages/core/src/plugin/provider/index` (upstream still inline list) → provider-add commits conflict there.
- V2 field renames in progress upstream (`provider.endpoint`→`provider.api`, `ConfigMCP`→`ConfigMCPV1`) → core/mcp commits often need translation.
