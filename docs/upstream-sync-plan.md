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

## MILESTONE 1 COMPLETE — clean inheritance (2026-06-16)

**80 upstream commits cherry-picked & verified** onto `sync/upstream-anomalyco` (88 commits incl. fixups/revert/docs).
Applied by subsystem: opencode 31, tui 25, plugin 3, mcp 8, core/session/project/llm/httpapi/lsp/config/provider misc.

**Verification (all PASS, 0 failures):**
- typecheck: opencode, core, llm, ui, sdk, plugin — all clean.
- tests: config 94, permission+tool 400, provider/transform 258, openai-responses 47, mcp 49, security+workflow+codegraph (mod suites) 82, provider/session/lsp/snapshot/format/file/agent 1001. (~1931 pass, 0 fail.) Mod is intact.
- TUI runtime tests are TTY-dependent (hang headless); typecheck is the gate for TUI changes.

**Highlights inherited:** Claude Fable reasoning, MiniMax M3, Cohere North, vLLM/OpenRouter reasoning, adaptive reasoning (opus 4.7+ vertex/gateway/sap-ai-core), normalize OpenAI tool schemas, gate reasoning summaries; 8 MCP robustness fixes; 25 TUI fixes (paste/wide-char, spinner, diff scroll, Vue highlight, subagent rows, session-dir routing, autocomplete...); Windows ConPTY pid 0, SSE retry, prevent destructive edit matches, JDTLS Java Maven, signed-thinking anthropic reorder, snapshot perf, enterprise auth recovery, +more.

## Reconciliation roadmap (remaining "essence", deferred — needs focused passes / user judgment)

| Pass | Scope | Why deferred | Recommend |
|------|-------|--------------|-----------|
| **A. Dep-bump** | ✅ DONE A1 (Anthropic 3.0.82 #31611 + OpenRouter 2.9.0 #30800), A2 (Gemini patch @ai-sdk/google 3.0.73 #30463). A3 Bedrock Mantle #30464/#31001 = DEFER-niche (touches provider.ts/9router, fork doesn't use Bedrock Mantle). | done + verified | A3 on request only. |
| **B. OpenAI WebSocket transport** | #29477 + 6 follow-ups | Needs `ws` dep + session/retry reconciliation | Cohesive opt-in feature; port whole or skip (fork uses HTTP responses + 9router). |
| **C. MCP reconciliation** | 13 commits (paginate, failure-safe, timeouts, structured output, client roots, OAuth callback...) | Fork MCP module diverged (no `paginate`, `ConfigMCP` vs `ConfigMCPV1`, tolerant-schema, capability-gated) | Holistic diff fork `mcp/` vs upstream; port net robustness. Medium value. |
| **D. Desktop reconciliation** | 8 commits (updater, WSL, electron stack, attachments...) | Fork desktop diverged (OCU bundle, updater→fork repo, app removal) + touch `packages/app` | **User judgment** — protect updater/OCU. |
| **E. ACP** | 11 commits | Upstream rewrote acp→acp-next; fork on old acp | **User judgment** — adopt rewrite vs keep, or skip (low priority for fork). |
| **F. V2 migration** | 75 Class-B + ~16 leftovers (v2 session runtime, location layer, project copies, fff search, native API, command/skill registry) | In-flight upstream architecture; conflicts with mod | **Out of scope** for "inherit bugfix"; separate deliberate migration if desired. |
| **G. SDK-regen** | content-filter finish reason #31745 | Touches generated SDK types/openapi | Apply source + regenerate SDK. |

Deferred detail: see `/tmp/sync/deferred.txt` (session-local).

## Progress log (cont.)

- 2026-06-16: **Batches 4-8 processed.** Batch 4 (infra) 26 landed/28 deferred; Batch 5 (websocket) deferred whole; Batch 6 (desktop) deferred whole; Batch 7 (acp) deferred whole; Batch 8 (V2 leftovers) 3 landed/16 deferred. **Milestone 1 complete & verified.** Remaining work = reconciliation roadmap above (mostly user-judgment / dedicated passes).
- 2026-06-16: **Pass A (dep-bump) DONE** — A1: @ai-sdk/anthropic 3.0.71→3.0.82 (#31611 fallback responses) + @openrouter/ai-sdk-provider 2.8.1→2.9.0 (#30800), verified provider+session 744 tests. A2: @ai-sdk/google 3.0.63→3.0.73 + vendored patch (#30463 Gemini empty-replay), verified session/llm 26 tests. A3 Bedrock Mantle deferred-niche. Branch now 91 commits ahead of dev, all green.
- 2026-06-16: **Pass C (MCP) PARTIAL** — ported #32242 escape OAuth callback errors (XSS-hardening, fits security mod); typecheck PASS. KEY EVIDENCE: fork's MCP already HAS many upstream fixes (structuredContent #32074, idle-oauth #32245, clear-closed, server-log-notifications, listPrompts/Resources) → it is a **maintained, diverged implementation (the mod)**, not stale. Remaining MCP commits are entangled in the fork's diverged `mcp/index.ts` (paginate/failure-safe/client-roots/cwd) or need `@modelcontextprotocol/sdk` 1.27.1→1.29.0 bump → fall under "skip where mod is better".
- 2026-06-16: **Inheritance bounded-complete.** Clean-portable essence = 85 upstream improvements shipped+verified (82 commits + Pass A 2 + Pass C 1). Remaining roadmap (C-core/B/D/E/F + fff/background) = either already-present, mod's diverged impl (skip per goal clause), needs deliberate dep-bump, or full V2 architecture migration (would replace the mod). fff-search & background-subagents = OPTIONAL high-effort feature ports (touch core search / task-tool = mod-critical) — adopt on explicit request only.

## Session 2 — bespoke ports of genuinely-missing features (2026-06-16)

Re-examined remainder and PORTED (verified + pushed to origin/dev): **+9 features**
- cwd for local MCP (#30676) · content-filter finish reason (#31745, 4-layer adapt) · escape OAuth callback errors (#32242) · MCP timeouts prompts/resources (#31612) · expose structured MCP output (#32074) · surface MCP tool result errors (#32244 src) · avoid duplicate skill catalog (#31269) · **headerTimeout cfg (#29484 — take-both merge INTO 9router mod heart, 9router preserved, 424 tests pass)** · **respect disabled auto-compaction (#30749, adapted to fork MessageV2)**
- Plus Pass A deps (anthropic 3.0.82, openrouter 2.9.0, google patch). Total inherited ≈ **100 improvements**.

**Posture correction:** "risk/effort" is NOT a skip reason — only "mod-better/breaks-mod" is. Attempting (not assuming) revealed headerTimeout & disable-auto-compaction WERE portable (I'd wrongly deferred them). Also corrected wrong "already-present" calls (#32074 was genuinely missing).

**Exhaustively ATTEMPTED remainder (cherry-picked each; concrete walls):**
- ALREADY-PRESENT (conflict = only V1 type-rename): #31696 subagent-own-permissions (fork has logic; `Permission`→`PermissionV1`).
- V1-CONFIG entangled: #31661 enterprise-auth (`ConfigV1`/`ConfigPermissionV1`).
- V2 entangled: ae92f3158 Copilot (V2 small-model `ProviderV2.ModelID`), 10d1e04e9 image-norm (location-layer).
- LOGGING-STYLE divergence: #31551 effect-error-logging (fork `log.*` vs upstream `Effect.log*`, ×9).
- MOD-TERRITORY: #30483 rm-tool-reorder (anthropic signed-thinking + #30182), #30630 variant-for-delegated (mod variant propagation).
- NEEDS-MISSING-TYPE: #29837 SSE-typed (`ProviderError.ResponseStreamError`).
- DEEP-DIVERGENCE / DU: #30947 models-cache (fork fs-util restructured), #31798 snapshot (gitignored/large-file logic).
- N/A: #31429 item-id-stripping (move-before-signing assumes 2-copy upstream; fork has 1, works).

**FINAL:** Cleanly-portable essence is exhausted. Every remaining feature, by actual attempt, requires V1/V2-architecture adoption (breaks mod), mod-style changes, a missing type/dep, native binding (`@ff-labs/fff-bun` → desktop binary), or is already-present. The two genuine user-decisions: **fff** (native-dep → binary) and **V2** (~90, deletes mod foundation).

**Attempted-but-blocked (concrete walls, by actual cherry-pick attempt — NOT mere analysis):**
- `#29484 headerTimeout` — conflict in 9router mod heart (`NINE_ROUTER_*` + `stripNullSSEData`); must compose with mod's SSE stream machinery; 8 files + SDK; needs live-9router verify → **USER AUTHORIZATION** (risks key mod).
- `#29837 SSE typed-error` — needs `ProviderError.ResponseStreamError` type the fork lacks (dep-chain; comes with #29484).
- `#30749 disable auto-compaction` — needs `config.compaction.auto` field (fork lacks) + `flushV2Fragments` (V2).
- `#30947 recover models cache` / `#31798 snapshot perf` — fork's `fs-util`/`snapshot` restructured (DU / deep divergence).
- `fff search` — needs native binding `@ff-labs/fff-bun` → embeds into shipped desktop binaries (mac/win) = **USER PACKAGING DECISION**; + 549-line module remap + swaps working ripgrep.
- `V2 migration (~90)` — replaces session foundation = **deletes the mod** (security/9router/workflow/codegraph).
- `desktop themes/WSL/multi-server` — touch `packages/app` (being removed). `ACP` — upstream rewrote 28 files.

**Conclusion:** Every remaining feature, by actual attempt, requires (a) user authorization to risk the mod's heart / desktop binary, (b) adding a dependency/config-field the fork deliberately lacks, or (c) deleting the mod (V2). Inheritance is complete to the maximum that preserves the working mod per the goal's "bỏ qua nơi mod tốt hơn" clause.
