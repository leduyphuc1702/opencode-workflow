# OpenCode Workflow + Embedded CodeGraph: Agent-Orchestrated Codebase Understanding Roadmap

> This plan is for developing `opencode-workflow`: an agent-orchestrated OpenCode workflow runtime with embedded CodeGraph.
>
> First distribution target: packaged macOS desktop app (`.dmg`), not the CLI or a standalone MCP experiment.

---

## 1. Product Goal

Build `opencode-workflow`: a workflow layer on top of OpenCode where an orchestrator agent owns user dialogue, routes work to specialized sub-agents, and forces codebase understanding through embedded CodeGraph before broad raw search.

Target outcome:

```text
User opens project in OpenCode Desktop .dmg
-> Electron app starts local opencode sidecar server
-> app opens normally without blocking on CodeGraph
-> user starts a new working session / submits a prompt
-> CodeGraph sync runs for that project directory with visible percent progress
-> CodeGraph watcher keeps the graph fresh during agent work
-> orchestrator-agent
-> Codebase Understanding System
-> plan-agent
-> plan-reviewer
-> plan-finalizer
-> user approval
-> implementation agents
-> code-reviewer
-> final user approval
```

Design principles:

```text
- Embedded CodeGraph is the product path.
- MCP is a development fallback, not the default product architecture.
- CodeGraph sync must complete before session prompt / agent work starts, not before the app can open.
- Broad grep/read is fallback behavior, not the first understanding path.
- Orchestrator-agent is the only default user-facing agent.
- Remote skills are task-scoped leases, not permanent project dependencies.
- Sub-agents break through orchestrator instead of asking the user directly.
- Every codebase claim should point back to graph, file, tool, or test evidence.
```

---

## Implementation Status Update — 2026-05-26

This section records what has been implemented in the current workspace and what remains before the full `opencode-workflow` plan is complete.

### Implemented

- Installed Bun locally for this workspace (`~/.bun/bin/bun`) and used it for typecheck/build/package commands.
- Bundled `@colbymchenry/codegraph@0.9.4` into `packages/opencode`.
- Added native `CodeGraph.Service` in `packages/opencode/src/codegraph/index.ts`.
- Added bundled CodeGraph packaging via `packages/desktop/electron-builder.config.ts`, copying the platform package into the app bundle under `Resources/codegraph`.
- Added native codebase tools in `packages/opencode/src/tool/codebase.ts` and registered them in `ToolRegistry`:
  - `codebase_status`
  - `codebase_files`
  - `codebase_context`
  - `codebase_search_symbol`
  - `codebase_callers`
  - `codebase_callees`
  - `codebase_impact`
  - `codebase_affected_tests`
  - `codebase_node`
  - `codebase_trace`
  - `codebase_explore`
- Reused `@colbymchenry/codegraph`'s bundled MCP `ToolHandler` internally for `codebase_node`, `codebase_trace`, and `codebase_explore`, because those capabilities exist in the package library but are not exposed as CLI subcommands in `0.9.4`.
- Added persisted workflow evidence store in `packages/opencode/src/workflow/evidence.ts`.
- CodeGraph session sync success/failure and native codebase tool calls now append `EvidenceEvent` records under session-scoped storage.
- Added workflow-owned built-in skill prompt: `packages/opencode/src/skill/prompt/opencode-workflow.md`.
- Added workflow agent prompt files:
  - `orchestrator-workflow.txt`
  - `plan-agent-workflow.txt`
  - `plan-reviewer-workflow.txt`
  - `plan-finalizer-workflow.txt`
  - `implementation-agent-workflow.txt`
  - `code-reviewer-workflow.txt`
- Added workflow protocol schema in `packages/opencode/src/workflow/protocol.ts`.
- Added persisted workflow runtime store in `packages/opencode/src/workflow/runtime.ts` for workflow state, FinalPlan approval, break checkpoints, resume packages, and graph-first fallback evidence.
- Added workflow agents to `packages/opencode/src/agent/agent.ts`, including `orchestrator-agent` as the default workflow-facing agent path.
- Added native workflow tools and registered them in `ToolRegistry`:
  - `workflow_state`
  - `workflow_approve_plan`
  - `workflow_break`
  - `workflow_resume_break`
- Added hard approval enforcement at `packages/opencode/src/session/tools.ts`: workflow agents cannot use mutation tools (`write`, `edit`, `apply_patch`, `bash`) until `workflow_approve_plan` records user approval for the session.
- Added graph-first fallback auditing at `packages/opencode/src/session/tools.ts`: workflow use of raw `read`, `grep`, or `glob` records `raw_fallback` evidence; `OPENCODE_WORKFLOW_STRICT_GRAPH_FIRST=1` can hard-block broad raw fallback until graph evidence exists.
- Added runtime-backed break/resume flow:
  - sub-agents call `workflow_break`
  - runtime stores `BreakRequest` + `ContextCheckpoint`
  - orchestrator asks the user
  - orchestrator calls `workflow_resume_break`
  - returned `taskResumeInput.task_id` resumes the same sub-agent session through the existing `task` tool
- Updated workflow prompts so sub-agents use `workflow_break` instead of asking users or returning ad hoc JSON.
- Remote URL skills are now marked `source: "remote"`, hidden from `available_skills`, and therefore not promoted into the long-lived skill registry.
- Loading an explicit remote skill records `skill_lease` evidence with source path, SHA-256 hash, and decision `lease_for_current_task_only`.
- Added `OPENCODE_DISABLE_CODEGRAPH` runtime flag.
- Fixed the desktop loading hang caused by `GET /project` creating an instance for `/Users/macos` and triggering CodeGraph sync over the home directory.
- Changed `InstanceBootstrap` so app/project boot no longer blocks on CodeGraph sync.
- Moved CodeGraph readiness to session start:
  - `prompt` and `prompt_async` now run CodeGraph sync before `SessionPrompt.prompt`.
  - CodeGraph sync failure returns a recoverable session error instead of silently falling back to broad grep.
- Added `SessionStatus` variant `codegraph_syncing` with `percent` and optional `message`.
- Added UI timeline row that shows `CodeGraph <percent>%` and a small progress bar while sync runs.
- Built an official `prod` OpenCode macOS DMG at:
  - `packages/desktop/dist/opencode-desktop-mac-arm64.dmg`
- Smoke-tested the built app bundle: OpenCode opens into the UI normally instead of staying on the loading screen.
- Verified bundled CodeGraph binary inside the app bundle reports version `0.9.4`.

### Verified

- `packages/opencode`: `bun typecheck` passed.
- `packages/app`: `bun typecheck` passed.
- `packages/sdk/js`: `bun typecheck` passed.
- `packages/desktop`: `bun typecheck` passed.
- Focused HTTP test passed: project list route does not create a project instance.
- Focused prompt async context tests passed.
- Focused CodeGraph service test passed: fake bundled CLI initializes, indexes, reports progress, and reaches `ready`.
- Focused workflow evidence test passed: `EvidenceEvent` persists and can be listed/read by session.
- Focused workflow runtime tests passed: mutation is blocked before FinalPlan approval, raw fallback evidence is recorded, and break checkpoint/resume package persistence works.
- Focused tool registry test passed: bundled CodeGraph tool surface includes `codebase_node`, `codebase_trace`, and `codebase_explore`.
- Focused skill tests passed after remote skill filtering/lease changes.
- `OPENCODE_CHANNEL=prod bun run build` passed.
- `OPENCODE_CHANNEL=prod bun run package:mac` passed.

### Known Gaps / Not Complete Yet

- The DMG is not notarized yet. Current machine has no valid Apple code-signing identity (`security find-identity -v -p codesigning` returns `0 valid identities found`). Electron-builder falls back to ad-hoc signing, and `spctl` rejects the DMG.
- CodeGraph progress is phase-based synthetic progress because the bundled CodeGraph CLI does not expose stable machine-readable per-file progress yet.
- Break/resume now has persisted runtime state and resumes through the existing `task_id` mechanism. Remaining hardening is end-to-end UI/provider validation of a real paused sub-agent flow.
- Approval gates now have hard runtime enforcement for workflow mutation tools. Remaining hardening is wider E2E coverage across desktop UI sessions.
- Remote skills from configured URLs are no longer promoted into `available_skills` and explicit loads record task-scoped lease evidence. Remaining hardening is a cleanup job for cached remote bodies if product requires physical deletion after each task.
- Persisted `EvidenceEvent` storage now exists, but there is no Evidence Panel yet.
- Native CodeGraph tool parity now includes `codebase_node`, `codebase_trace`, and `codebase_explore`; remaining work is broader behavioral coverage and UI surfacing.
- Graph-first enforcement now records `raw_fallback` evidence and can be made strict with `OPENCODE_WORKFLOW_STRICT_GRAPH_FIRST=1`.
- `.codegraph/` is currently used as the working graph database in the project root for the MVP. A user-cache storage mode can be added later if product requirements change.
- End-to-end UI validation of the actual `CodeGraph xx%` row during a real prompt still needs a controlled small-repo test with provider credentials or a mocked provider path.

### Current Product Direction

The latest intended workflow is:

```text
OpenCode app opens normally
-> user starts a new working session / submits a prompt
-> CodeGraph sync starts for that project
-> UI shows CodeGraph percent progress
-> sync completes
-> orchestrator-agent begins work
-> CodeGraph watcher continues supervising graph freshness during the run
```

This replaces the older idea that project open or app loading should be blocked by CodeGraph sync.

---

## 2. Repo Reality Check

Facts from the current repo:

| Area | Current reality |
|---|---|
| Desktop packaging | `packages/desktop/electron-builder.config.ts` already targets macOS `dmg` and `zip`. |
| Desktop runtime | Electron main process in `packages/desktop/src/main/index.ts` starts a utility-process sidecar. |
| Local server | `packages/desktop/src/main/server.ts` forks `sidecar.js`; sidecar imports `virtual:opencode-server`. |
| Desktop loading state | Current init phases are `server_waiting`, `sqlite_waiting`, and `done`. |
| Project open UX | App-side project navigation/opening lives in `packages/app/src/pages/layout.tsx`. |
| Project runtime boot | Server-side project boot goes through `InstanceStore -> InstanceBootstrap`. |
| Bootstrap services | `InstanceBootstrap` already initializes config, plugin, reference, LSP, share, format, file, file watcher, VCS, snapshot, and project services. |
| Runtime service graph | `packages/opencode/src/effect/app-runtime.ts` composes the main `AppLayer`. |
| Tool registry | Built-in and plugin tools are resolved in `packages/opencode/src/tool/registry.ts`. |
| Tool execution hooks | `packages/opencode/src/session/tools.ts` already triggers `tool.execute.before` and `tool.execute.after`. |
| Tool definition hook | `ToolRegistry.tools` already triggers `tool.definition`. |
| Permission hook | Plugin API already exposes `permission.ask`. |
| Skills | `packages/opencode/src/skill/index.ts` loads built-in, project, global, configured-path, and configured-url skills. |
| Embedded CodeGraph | MVP native `CodeGraph.Service` now exists in `packages/opencode/src/codegraph/index.ts`. |

Implication: The next phases should harden the native service, session-start sync gate, progress UI, and orchestrator workflow runtime. Do not move back to an external MCP-only architecture.

---

## 3. Agent-Orchestrated Workflow

`opencode-workflow` is not just a CodeGraph tool bundle. It is a controlled workflow runtime where the orchestrator coordinates agents, gates, evidence, and user approvals.

### 3.1 Workflow Shape

```text
User prompt
-> orchestrator-agent
   -> normalize task brief
   -> verify CodeGraph ready
   -> route required local skills
   -> ask user only for missing product intent

-> plan-agent
   -> use codebase_context / trace / impact
   -> create PlanDraft with evidence ids

-> plan-reviewer
   -> critique PlanDraft against graph impact
   -> flag missing tests, risky APIs, unclear scope

-> plan-finalizer
   -> merge plan + review
   -> produce FinalPlan for user approval

-> implementation agents
   -> frontend-agent / backend-agent / targeted specialist
   -> edit only after relevant graph impact
   -> report progress/evidence to orchestrator

-> code-reviewer
   -> inspect diff, impact, and test selection
   -> request fixes or final approval
```

### 3.2 Orchestrator Responsibilities

```yaml
orchestrator-agent:
  owns:
    - user-facing communication
    - task brief
    - workflow state
    - user approval gates
    - sub-agent routing
    - BreakRequest normalization
    - ResumePackage creation
  must_use:
    - codebase_status
    - codebase_context
  cannot_do_by_default:
    - broad raw grep/read
    - direct implementation edits
    - silent scope expansion
```

### 3.3 Sub-Agent Contract

```yaml
sub_agent_contract:
  input:
    - TaskBrief or FinalPlan slice
    - allowed scope
    - required evidence ids
    - available skills
  output:
    - result summary
    - evidence ids
    - files touched or inspected
    - tests run or blocked
    - BreakRequest if blocked
  user_contact:
    direct_user_questions: false
    route_through: orchestrator-agent
```

### 3.4 Break / Resume Is Core Workflow

Break/resume is part of `opencode-workflow`, not a decorative future feature. It does not need to be implemented before the first CodeGraph service, but the architecture must reserve the state model from day one.

```text
Sub-agent blocked
-> emits BreakRequest
-> runtime saves ContextCheckpoint
-> orchestrator asks user
-> orchestrator creates ResumePackage
-> sub-agent resumes with original context plus new input
```

MVP sequencing:

- Phase 1 can ship CodeGraph without full break/resume.
- Phase 2 ships the orchestrator workflow skeleton for the first usable `opencode-workflow` milestone.
- Phase 2 must keep tool/session/evidence metadata compatible with break/resume.
- Phase 6 implements the full automatic pause/resume runtime.

---

## 4. Target Architecture

### 4.1 macOS DMG MVP Architecture

```text
OpenCode Desktop (.dmg)
  packages/desktop
  ├─ Electron main process
  │  ├─ starts sidecar server
  │  ├─ reports server/sqlite startup progress
  │  └─ opens renderer app
  │
  └─ OpenCode server sidecar
     packages/opencode
     ├─ AppLayer
     ├─ InstanceStore
     ├─ InstanceBootstrap
     ├─ CodeGraph.Service
     ├─ Session prompt CodeGraph sync gate
     ├─ ToolRegistry
     ├─ SessionTools
     └─ Plugin hooks
```

### 4.2 Full opencode-workflow Architecture

```text
OpenCode Runtime
  ├─ orchestrator-agent
  ├─ sub-agents
  │  ├─ plan-agent
  │  ├─ plan-reviewer
  │  ├─ plan-finalizer
  │  ├─ frontend-agent
  │  ├─ backend-agent
  │  └─ code-reviewer
  ├─ Codebase Understanding System
  │  ├─ Embedded CodeGraph Engine
  │  ├─ Project Sync Gate
  │  ├─ Always-On Watcher
  │  ├─ Context Router
  │  ├─ Graph-First Policy
  │  ├─ Impact Analyzer
  │  ├─ Affected Test Selector
  │  └─ Evidence Graph
  ├─ Task-scoped Skill Runtime
  ├─ Break/Resume Runtime
  └─ Evidence UI
```

The first `.dmg` milestone can implement the CodeGraph service before the full workflow runtime, but the plan is still for `opencode-workflow`: every service/tool/evidence shape should be compatible with orchestrated agents.

---

## 5. CodeGraph Core Service

### 5.1 Service Boundary

Add a native OpenCode service in `packages/opencode`, conceptually:

```ts
type CodeGraphStatus =
  | { status: "idle" }
  | { status: "syncing"; phase: "opening" | "indexing" | "validating" }
  | { status: "ready"; graphVersion: string; lastSyncAt: number }
  | { status: "stale"; graphVersion?: string; lastSyncAt?: number }
  | { status: "failed"; error: string; retryable: boolean }

interface CodeGraphRuntime {
  status(directory: string): Effect.Effect<CodeGraphStatus>
  sync(directory: string): Effect.Effect<CodeGraphStatus>
  watch(directory: string): Effect.Effect<void>

  files(input: { directory: string; path?: string }): Effect.Effect<CodebaseFilesResult>
  context(input: CodebaseTask): Effect.Effect<ContextBundle>
  searchSymbol(input: SymbolSearchQuery): Effect.Effect<SymbolSearchResult>
  node(input: NodeQuery): Effect.Effect<NodeDetail>
  trace(input: TraceQuery): Effect.Effect<TraceResult>
  impact(input: ImpactQuery): Effect.Effect<ImpactResult>
}
```

Implementation rule: follow existing OpenCode service style. Provide `CodeGraph.defaultLayer`, add it to `AppLayer`, and use `InstanceState.make` for per-project state instead of global mutable singletons.

### 5.2 Integration Point

Current MVP integration point: session prompt start, not project boot:

```text
User submits prompt / starts working session
-> Session HTTP handler validates session
-> CodeGraph.ensureReady(directory, onProgress)
-> SessionStatus.codegraph_syncing(percent, message)
-> SessionPrompt.prompt(...)
-> orchestrator-agent / selected agent runs
-> CodeGraph watcher keeps syncing file changes in the background
```

Rationale:

- OpenCode must open normally even if CodeGraph sync is slow.
- The user should see CodeGraph progress at the moment they start work.
- CodeGraph still gates agent work, but it does not gate the entire desktop app.
- This avoids accidentally indexing broad directories such as the user's home folder during generic project listing routes.

Historical note: an earlier version placed CodeGraph in `InstanceBootstrap`. That caused the app to appear stuck when a non-project/global request created an instance for `/Users/macos`. The MVP now keeps `InstanceBootstrap` lightweight and gates only session work.

### 5.3 Storage Policy

For the current `.dmg` MVP:

```text
Default graph storage: project-local `.codegraph/`
Key: normalized project/worktree directory
`.codegraph/` is treated as the working CodeGraph database for opencode-workflow.
```

Rationale:

- This matches the current bundled `@colbymchenry/codegraph` CLI behavior and keeps the MVP plug-and-play.
- `.codegraph/` is only created when the user starts a working session that needs CodeGraph, not simply when the app opens.
- If product requirements later demand zero repo writes, add an OpenCode user-cache storage mode behind config.

### 5.4 Engine Strategy

Preferred order:

```text
1. Import CodeGraph as a library if it has a stable Node/Bun-compatible API.
2. If no library API is ready, run a bundled local CodeGraph worker or CLI via IPC/JSON.
3. Use MCP only for development validation, not as the shipped product path.
```

The feasibility spike must answer:

- Can CodeGraph run inside the Electron sidecar process safely?
- Does it need native binaries or extra resources in the `.dmg` bundle?
- Can it share the existing file watcher, or does it need its own watcher?
- What is the cold index cost on medium and large repositories?
- Where should the graph DB live under OpenCode user state?

---

## 6. Project Sync Gate

### 6.1 MVP Requirement

When a working session begins or the user submits a prompt:

```text
1. Resolve project/worktree directory.
2. Open or create CodeGraph store for that directory.
3. Run full index or incremental sync.
4. Validate graph health.
5. Start watcher.
6. Allow project-specific agent/session work.
```

OpenCode app and project navigation should remain usable before CodeGraph is `ready`. Project-specific planning, implementation, review, or codebase Q&A should not run before the session's CodeGraph sync has completed or produced a classified recoverable failure.

### 6.2 Desktop User Feedback

Desktop app currently has init phases:

```ts
type InitStep =
  | { phase: "server_waiting" }
  | { phase: "sqlite_waiting" }
  | { phase: "done" }
```

Do not extend this startup flow for the current MVP because CodeGraph no longer blocks before the main window is visible. CodeGraph status is exposed inside the session UI instead.

Historical possible extension, not current MVP behavior:

```ts
type InitStep =
  | { phase: "server_waiting" }
  | { phase: "sqlite_waiting" }
  | { phase: "codegraph_syncing"; directory: string; progress?: number }
  | { phase: "done" }
```

For the current implementation, show a session timeline status row: `CodeGraph <percent>%`.

### 6.3 Stale Graph Policy

MVP policy:

```yaml
stale_graph_policy:
  planning: pause_until_synced
  implementation: pause_until_synced
  review: pause_until_synced
  raw_read: allow_with_warning
  grep: allow_with_warning
```

Strict blocking of raw read/grep should wait until native codebase tools are stable. Early hard blocking would make the desktop app feel broken if indexing fails.

Later strict policy:

```yaml
strict_graph_first_policy:
  raw_read: targeted_only
  broad_grep: deny_by_default
  fallback_requires_evidence: true
```

---

## 7. Native Codebase Tools

Expose native tools through `ToolRegistry`, not through an external MCP server:

```text
codebase_status
codebase_files
codebase_context
codebase_search_symbol
codebase_callers
codebase_callees
codebase_impact
codebase_affected_tests
codebase_node
codebase_trace
codebase_explore
```

`codebase_node`, `codebase_trace`, and `codebase_explore` reuse the bundled CodeGraph MCP `ToolHandler` internally because CodeGraph `0.9.4` exposes those capabilities in the library/MCP surface, not as CLI subcommands.

Tool rules:

- Each tool output includes graph status/version/timestamp evidence when available.
- Each tool output includes enough evidence for the agent to cite the result.
- Tool descriptions should tell the model to use codebase tools before `grep`, `glob`, `list`, or broad `read`.
- Tool implementation should follow existing `Tool.define` style.

---

## 8. Graph-First Enforcement

### 8.1 Phase 1: Soft Enforcement

Use tool descriptions, system prompt guidance, and native codebase tools:

```text
Preferred:
  codebase_context -> codebase_node/trace/impact -> targeted read if needed

Fallback:
  grep/glob/read only when graph cannot answer or user asks for literal text search
```

This phase should not block existing tools.

### 8.2 Phase 2: Hook-Based Enforcement

Use the hooks already present in the repo:

```text
tool.definition
  - adjust read/grep/glob/list descriptions to point to CodeGraph first

tool.execute.before
  - inspect broad raw search/read attempts
  - check whether current session has recent CodeGraph evidence
  - warn or block based on configured policy

tool.execute.after
  - record evidence events for graph queries and raw fallbacks

permission.ask
  - route strict fallback approval through existing permission flow
```

Do not add a second hook system unless existing hooks are proven insufficient.

---

## 9. Evidence Model

MVP evidence is structured metadata, not a full UI panel.

```ts
type EvidenceEvent = {
  id: string
  sessionID?: string
  messageID?: string
  toolCallID?: string
  directory: string
  kind: "codegraph_sync" | "graph_query" | "raw_fallback" | "impact" | "test"
  graphVersion?: string
  summary: string
  createdAt: number
}
```

Store enough information to debug agent behavior:

- graph sync start/end/failure
- graph version used by each codebase tool
- raw grep/read fallback reason
- impact query before edits
- selected tests before review

Full Evidence Panel is a later UI phase.

---

## 10. Skills and Remote Skills

Current repo already supports skills from:

- built-in skill body
- project `.opencode/skill(s)`
- global `.claude/skills` and `.agents/skills`
- configured `skills.paths`
- configured `skills.urls`

Current repo behavior already helps with overload:

- skill descriptions are listed in the agent system prompt
- the full skill body is loaded lazily through the `skill` tool
- `Skill.available(agent)` filters visible skills through `agent.permission`
- per-agent `permission.skill` can allow, deny, or ask for skill patterns

For this roadmap:

```text
MVP:
  keep lazy skill loading
  add orchestrator-owned per-agent Skill Router

Later:
  add task-scoped remote skill leases
```

### 10.1 Per-Agent Skill Router

The Skill Router is required for `opencode-workflow`. Its job is to prevent every agent from seeing or loading every skill.

```text
TaskBrief
-> orchestrator-agent classifies task needs
-> Skill Router selects skill candidates per agent
-> agent receives only skill descriptions relevant to its role/task slice
-> agent calls skill tool only when the selected skill is needed
-> loaded skill body is scoped to that agent turn/task slice
```

Routing rules:

```yaml
skill_router:
  default_policy: deny_unless_relevant
  full_skill_body_loading: lazy_only
  catalog_visibility: per_agent_filtered
  remote_skills: break_request_required
  evidence_required:
    - selected_skill
    - selection_reason
    - agent_id
    - task_slice_id
```

Per-agent defaults:

```yaml
orchestrator-agent:
  sees:
    - workflow/planning/clarification skills
    - skill metadata for routing
  loads:
    - only skills needed to ask better user questions or route work

plan-agent:
  sees:
    - codebase understanding
    - planning
    - architecture
  denied_by_default:
    - deployment
    - UI visual design
    - provider-specific implementation skills

plan-reviewer:
  sees:
    - review
    - risk analysis
    - architecture critique
    - testing strategy

frontend-agent:
  sees:
    - UI/UX
    - framework-specific frontend skills
    - accessibility

backend-agent:
  sees:
    - API
    - database
    - auth/permission
    - integration-specific skills

code-reviewer:
  sees:
    - review
    - testing
    - security/risk
  denied_by_default:
    - implementation-only generation skills
```

Implementation path:

- Use existing `permission.skill` as the first routing mechanism.
- Add workflow-generated per-agent skill allowlists before a sub-agent starts.
- Keep full skill bodies out of orchestrator context unless the orchestrator itself needs the skill.
- Record selected/rejected skills as evidence events.
- If a required skill is remote or missing, sub-agent emits `BreakRequest` and orchestrator asks user.

MVP acceptance for Skill Router:

```text
1. Each agent sees only role/task-relevant skill descriptions.
2. Full SKILL.md content is loaded only after explicit skill tool use.
3. Orchestrator can explain why a skill was exposed to an agent.
4. A denied skill is hidden from that agent and cannot be loaded directly.
5. Remote skill requests go through BreakRequest instead of automatic install.
```

---

Remote skills from `skills.sh` must remain temporary per task:

- no permanent install into project skill registry
- no write to global skill directories
- no long-term `skills.lock`
- keep only evidence summary, URL, hash, audit result, and decision log after task end

This is not required for the macOS `.dmg` CodeGraph MVP.

---

## 11. Break / Resume Protocol

Break/resume is a core `opencode-workflow` protocol. It can be implemented after the first CodeGraph service lands, but earlier phases must preserve the metadata needed to add it without redesigning session/tool state.

Required flow:

```text
Sub-agent blocked
-> emits BreakRequest
-> runtime saves ContextCheckpoint
-> orchestrator asks user
-> orchestrator creates ResumePackage
-> sub-agent resumes with original context plus new input
```

Implementation dependency:

1. CodeGraph service exists.
2. Codebase tools exist.
3. Evidence events exist.
4. Session/tool metadata can point to graph versions reliably.

---

## 12. What Was Reduced From The Original Idea Draft

The previous rewrite reduced too much by demoting orchestrator workflow. This revision restores orchestrator as the main product shape. The plan is still intentionally shorter than the original idea draft in these ways:

```text
Kept:
- orchestrator-agent as the only default user-facing agent
- plan-agent / plan-reviewer / plan-finalizer workflow
- implementation agents and code-reviewer
- per-agent Skill Router to prevent skill/context overload
- CodeGraph ready gate
- graph-first policy
- BreakRequest -> ContextCheckpoint -> ResumePackage
- task-scoped remote skills as long-term requirement
- macOS .dmg as first distribution target

Compressed:
- long TypeScript schemas are described by protocol shape instead of full field-by-field definitions
- remote skill security rules are summarized instead of expanded into a full lease spec
- Evidence Panel is reduced to EvidenceEvent first, full UI later
- agent policy YAML is shortened to core contracts
- detailed UI mockups are removed until app integration is designed

Removed:
- invented `.opencode/plugins/*.ts` project structure that does not match the repo
- claims that CodeGraph already exists as native OpenCode product code
- hard blocking raw grep/read on day one
- permanent remote skill promotion
- MCP as shipped product default
```

Reason for compression: keep the roadmap implementable in this repo while preserving the `opencode-workflow` orchestration design.

---

## 13. Feature Parity Checklist

This checklist tracks whether the current repo-grounded roadmap still covers the feature intent of the original idea draft.

| Original feature area | Status | Current plan location | Notes |
|---|---|---|---|
| Agent-orchestrated workflow | Covered | Sections 1, 3, 4, 13 | Orchestrator remains the product center. |
| Orchestrator-only user dialogue | Covered | Sections 3.2, 14, 15 | Sub-agents route blockers through orchestrator. |
| Plan-agent / plan-reviewer / plan-finalizer | Covered | Sections 3.1, 4.2, 13, 14 | Included in workflow and acceptance criteria. |
| Frontend/backend implementation agents | Covered | Sections 3.1, 4.2, 13 | Kept as roles; exact agent files still to design. |
| Code-reviewer | Covered | Sections 3.1, 4.2, 13 | Kept as final review agent. |
| Per-agent Skill Router | Covered | Section 10.1 | Added to prevent skill/context overload. |
| Task-scoped remote skills | Implemented MVP | Status update, Sections 10, 13 | Remote URL skills are hidden from `available_skills`; explicit loads record `skill_lease` evidence with hash/source/decision. |
| RemoteSkillLease schema | Implemented MVP | Status update, Section 10 | Represented as `skill_lease` `EvidenceEvent` data for MVP. |
| CodeGraph embedded product path | Covered | Sections 5, 6 | Native service path replaces MCP product default. |
| CodeGraph session-start sync gate | Implemented MVP | Status update, Sections 5, 6, 14 | App opens normally; prompt/session work waits for graph readiness. |
| Always-on watcher / stale policy | Covered | Sections 5, 6, 13 | Policy is warning-first, strict later. |
| Native codebase tools | Implemented MVP | Status update, Sections 7, 14 | Core tools plus callers/callees/affected_tests/node/trace/explore implemented; broader behavioral tests still needed. |
| `codebase_understand` | Missing detail | Section 7 | Should be restored as either alias or higher-level orchestrator tool. |
| `codebase_callers` / `codebase_callees` | Implemented MVP | Status update, Sections 7, 14 | Added through native codebase tools. |
| `codebase_explore` | Implemented MVP | Status update, Sections 7, 14 | Implemented by reusing bundled CodeGraph MCP ToolHandler internally. |
| `codebase_affected_tests` | Implemented MVP | Status update, Sections 7, 14 | Added through native codebase tools; needs focused tests. |
| Graph-first enforcement | Implemented MVP | Status update, Section 8 | Raw `read`/`grep`/`glob` records fallback evidence; strict blocking is available behind `OPENCODE_WORKFLOW_STRICT_GRAPH_FIRST`. |
| Agent policy matrix | Partial | Sections 3.2, 3.3, 10.1 | Core contracts exist; full `must_use/cannot_use/raw_tools` matrix not restored. |
| Evidence model | Implemented MVP | Section 9 | `EvidenceEvent` schema and persisted session-scoped store exist; full Evidence Graph and UI later. |
| Evidence Panel | Deferred | Sections 9, 13 | Kept as Phase 6. |
| Workflow Timeline UI | Missing detail | Section 13 | Needs UI spec if still required. |
| Skill Inspector UI | Missing detail | Section 10.1 | Router exists; inspector UI not specified. |
| Break Request Panel | Deferred | Section 11 | Runtime state exists; dedicated UI panel is later. |
| Resume Summary UI | Deferred | Section 11 | ResumePackage output exists through tool output; dedicated UI is later. |
| Remote Skill Approval Card | Missing detail | Section 10 | Approval rule exists; UI not restored. |
| Diff Review UI | Missing detail | Sections 3, 13 | Code-reviewer exists; UI spec not restored. |
| BreakRequest schema | Implemented MVP | Sections 3.4, 11, 13 | Runtime persists `BreakRequest` and checkpoint state. |
| UserQuestion schema | Missing detail | Section 11 | Needs schema in implementation spec. |
| ContextCheckpoint schema | Implemented MVP | Sections 3.4, 11, 13 | Runtime persists checkpoints keyed by BreakRequest id. |
| ResumePackage schema | Implemented MVP | Sections 3.4, 11, 13 | Runtime persists resume packages and returns `taskResumeInput` for same-session resume. |
| Workflow runtime states | Implemented MVP | Section 13 Phase 0 | Persisted runtime state is stored per workflow session. |
| Artifact store | Implemented MVP | Sections 9, 11 | Runtime artifacts use the existing session-scoped `Storage` service. |
| Approval gates | Implemented MVP | Sections 3, 13, 14 | `workflow_approve_plan` unlocks mutation tools; pre-approval mutation is blocked at tool execution. |
| Metrics | Missing detail | Section 13 | Sync/break/remote-skill/graph-first metrics not restored. |
| macOS `.dmg` target | Covered | Sections 1, 2, 4, 13, 15 | First distribution target. |
| `.opencode/plugins/*.ts` generated structure | Replaced | Section 12 | Removed because it did not match current repo. |
| MCP as product default | Replaced | Sections 1, 5, 12 | MCP remains development fallback only. |

Parity rule:

```text
Covered = ready to keep as roadmap requirement.
Partial = feature intent is present, but detailed spec/schema/UI is still needed.
Deferred = intentionally later phase, still part of roadmap.
Missing detail = should be expanded before implementation of that feature.
Replaced = original concept changed because current repo reality makes another path better.
```

Before implementation begins for any feature marked `Partial`, `Deferred`, or `Missing detail`, write the detailed spec in the relevant section instead of relying on the compressed roadmap.

---

## 14. Roadmap

### Phase 0: Workflow and CodeGraph Feasibility

- [x] Define the orchestrator state machine: intake, codegraph_syncing, brainstorming, planning, plan_review, awaiting_plan_approval, implementation, code_review, done, failed.
- [x] Define TaskBrief, PlanDraft, PlanReview, FinalPlan, BreakRequest, ContextCheckpoint, and ResumePackage at protocol level.
- [x] Map orchestrator/sub-agent routing onto existing OpenCode agent/task capability at prompt/agent-definition level.
- [x] Decide library vs local worker/CLI adapter: MVP uses bundled local CodeGraph CLI adapter.
- [x] Confirm CodeGraph can run in the Electron sidecar on macOS.
- [x] Confirm `.dmg` packaging needs for CodeGraph platform package.
- [ ] Measure cold sync and incremental sync on small, medium, and large repos.
- [x] Decide graph storage path for MVP: project-local `.codegraph/` working database.

Exit criteria:

- A minimal local prototype can index one project from the sidecar environment.
- The prototype can return files, symbol search, and one context query.
- Packaging constraints are known.
- Orchestrator protocol can be implemented without fighting current session/tool architecture.

### Phase 1: Core Service and Project Gate

- [x] Add `CodeGraph.Service` to `packages/opencode`.
- [x] Add `CodeGraph.defaultLayer` to `AppLayer` and HTTP route layer.
- [x] Remove CodeGraph from `InstanceBootstrap` so app/project boot stays responsive.
- [x] Gate session prompt/agent work until CodeGraph sync succeeds or returns a classified failure.
- [x] Start watcher through CodeGraph service materialization.
- [x] Expose service status for app/server/tool use.
- [x] Persist/log structured CodeGraph sync ready/failed and native graph query events as `EvidenceEvent` records.
- [ ] Persist stale transitions as `EvidenceEvent` records outside prompt-start sync.

Exit criteria:

- A user prompt in local desktop dev initializes CodeGraph before agent work.
- A failed CodeGraph sync produces a visible, recoverable failure state.
- `.codegraph/` is accepted as the MVP working database.

### Phase 2: Agent-Orchestrator Workflow Skeleton

- [x] Add orchestrator-agent definition and workflow state model at prompt/protocol level.
- [x] Add plan-agent, plan-reviewer, plan-finalizer, implementation-agent, and code-reviewer roles.
- [x] Add per-agent Skill Router using existing `permission.skill` filtering as the first mechanism.
- [ ] Generate task-specific skill allowlists for each sub-agent before invocation.
- [x] Route all user-facing questions through orchestrator-agent at agent-policy level.
- [x] Add hard runtime plan approval gate before implementation.
- [x] Preserve evidence ids in persisted workflow artifacts.
- [x] Add BreakRequest stubs even if full resume is implemented later.
- [x] Persist BreakRequest checkpoints and ResumePackages for same-subagent resume through `task_id`.

Exit criteria:

- User prompt flows through orchestrator before sub-agent work.
- Planning produces a user-approvable FinalPlan.
- Each sub-agent sees only skills relevant to its role and task slice.
- Sub-agents can report blocked state through orchestrator, even if resume is manual in this phase.

### Phase 3: Native Codebase Tools

- [x] Add `codebase_status`.
- [x] Add `codebase_files`.
- [x] Add `codebase_context`.
- [x] Add `codebase_search_symbol`.
- [x] Add `codebase_node`.
- [x] Add `codebase_trace`.
- [x] Add `codebase_explore`.
- [x] Add `codebase_callers`.
- [x] Add `codebase_callees`.
- [x] Add `codebase_impact`.
- [x] Add `codebase_affected_tests`.
- [x] Include graph status/version/timestamp evidence in tool outputs.

Exit criteria:

- Agent can answer basic codebase questions without broad grep/read.
- Tool outputs are compact enough for normal model context.
- Tool failure messages tell the agent what fallback is allowed.

### Phase 4: Graph-First Policy

- [ ] Update tool descriptions through `tool.definition`.
- [x] Record graph evidence on codebase tool calls.
- [x] Detect broad raw exploration in `tool.execute.before`.
- [x] Add warning mode for raw grep/glob/read without graph evidence.
- [x] Add strict mode behind config after warning mode is stable.

Exit criteria:

- Existing workflows continue to work in warning mode.
- Strict mode can block broad grep/read while allowing targeted file reads.

### Phase 5: Desktop Status

- [x] Decide whether CodeGraph status belongs in startup loading or project-open UI: current MVP shows it in session timeline, not startup.
- [x] Do not extend `InitStep` because CodeGraph does not block before the main window.
- [x] Show session-level `codegraph_syncing` with percent progress.
- [ ] Show project/session-level `ready`, `stale`, and `failed` graph states after sync.
- [ ] Add repair/resync action for failed or stale graph.

Exit criteria:

- macOS `.dmg` user can tell why a project is not ready.
- User has a clear retry path if indexing fails.

### Phase 6: Evidence, Break/Resume, Remote Skills

- [x] Persist `EvidenceEvent`.
- [ ] Add Evidence Panel.
- [x] Define BreakRequest, ContextCheckpoint, and ResumePackage at protocol level.
- [x] Route sub-agent blockers through orchestrator at runtime with persisted checkpoint/resume state.
- [x] Add task-scoped remote skill lease lifecycle.
- [ ] Delete remote skill bodies at task end.

Exit criteria:

- Reviewer can inspect why an agent chose a context, edit, fallback, or test.
- Sub-agent can pause and resume without losing context.
- Remote skill use leaves no persistent skill body.

---

## 15. MVP Acceptance Criteria

The first `opencode-workflow` macOS `.dmg` milestone is complete when:

```text
1. Packaged desktop can open a project and start local opencode sidecar normally.
2. Starting a working session / submitting a prompt runs CodeGraph sync for that project directory.
3. Agent project work waits until CodeGraph is ready or a classified failure is shown.
4. CodeGraph watcher keeps graph status fresh after initial sync.
5. User prompt enters orchestrator-agent before sub-agent work.
6. Planning runs through plan-agent, plan-reviewer, and plan-finalizer before implementation.
7. User approval is required before implementation agents edit.
8. Sub-agents report blockers through orchestrator-agent, not directly to the user.
9. Skill Router filters available skills per agent and task slice.
10. Full skill bodies are loaded lazily only through explicit skill tool use.
11. Native codebase tools are available to the agent workflow.
12. codebase tool outputs include graph status/version/timestamp evidence.
13. `.codegraph/` is accepted as the MVP working database; user-cache storage is a later option.
14. The user can see or recover from failed/stale graph state.
15. Basic graph-first codebase Q&A works without MCP.
16. Existing grep/read flows still work in warning mode during rollout.
```

---

## 16. Test Plan

### Docs and Type Safety

- [x] Review this roadmap against current repo paths.
- [x] Run `bun typecheck` from `packages/opencode` after service/tool changes.
- [x] Run `bun typecheck` from `packages/app` after session timeline UI changes.
- [x] Run `bun typecheck` from `packages/sdk/js` after generated type updates.
- [x] Run `bun typecheck` from `packages/desktop` after packaging changes.

### Core Runtime

- [x] Unit test CodeGraph status transitions with fake bundled CLI.
- [ ] Unit test storage path selection / `.codegraph/` MVP behavior.
- [ ] Integration test session `prompt` / `prompt_async` waits for CodeGraph readiness.
- [ ] Integration test failed sync returns a recoverable status.
- [ ] Integration test watcher marks graph stale or resyncs after file update.
- [x] Focused HTTP test: project list route does not create a project instance.
- [x] Focused HTTP prompt_async context tests pass.
- [x] Focused workflow evidence persistence test passes.

### Workflow Runtime

- [ ] Orchestrator receives user prompt and emits TaskBrief.
- [ ] plan-agent emits PlanDraft with evidence ids.
- [ ] plan-reviewer emits PlanReview before FinalPlan.
- [ ] plan-finalizer emits FinalPlan before implementation.
- [x] Approval gate prevents implementation before user approval.
- [ ] Skill Router exposes different skill allowlists for plan-agent, backend-agent, frontend-agent, and code-reviewer.
- [ ] Denied skills are hidden from the agent and rejected if loaded directly.
- [x] Sub-agent blocker becomes BreakRequest routed through orchestrator.

### Tooling

- [ ] Tool test `codebase_status`.
- [ ] Tool test `codebase_context`.
- [ ] Tool test `codebase_search_symbol`.
- [ ] Tool test `codebase_impact`.
- [ ] Tool test `codebase_callers` and `codebase_callees`.
- [ ] Tool test `codebase_affected_tests`.
- [x] Registry test confirms native CodeGraph tool surface includes `codebase_node`, `codebase_trace`, and `codebase_explore`.
- [x] Manual ToolHandler smoke test confirms bundled `codegraph_node` works against the current repo index.
- [x] Runtime test raw grep/read warning mode records fallback evidence.
- [ ] Hook integration test strict mode blocks broad fallback but allows targeted read.

### Desktop DMG

- [x] Run built app bundle smoke test; app opens past loading screen.
- [x] Run `OPENCODE_CHANNEL=prod bun run build` from `packages/desktop`.
- [x] Run `OPENCODE_CHANNEL=prod bun run package:mac` from `packages/desktop`.
- [ ] Install generated `.dmg` on macOS.
- [ ] Open a small repo and verify session `CodeGraph xx%` sync status during prompt.
- [ ] Open a large repo and verify app remains responsive.
- [x] Confirm bundled CodeGraph binary exists in packaged app and reports `0.9.4`.
- [ ] Produce notarized DMG after Apple signing identity and notarization credentials are available.

---

## 17. Non-Goals for the First DMG MVP

```text
- Do not build every advanced orchestrator feature before the first usable workflow.
- Do not require dedicated break/resume UI panels in the first milestone.
- Do not require physical deletion of cached remote skill bodies until the product decides cache policy.
- Do not build a full Evidence Panel yet.
- Do not require MCP for shipped CodeGraph behavior.
- Do not hard-block all grep/read until native codebase tools are stable.
- Do not block the whole OpenCode app on CodeGraph sync.
- Do not ship notarization claims without a valid Apple Developer signing/notarization pipeline.
```

---

## 18. Open Questions for Implementation

Resolved or still-open implementation questions:

1. Resolved for MVP: use bundled local CodeGraph CLI bridge, not a library API.
2. Resolved for MVP: bundle the CodeGraph platform package into Electron resources under `codegraph/`.
3. Resolved for MVP: use existing `FileWatcher` events to trigger background CodeGraph sync.
4. Resolved for MVP: use project-local `.codegraph/` as the working database.
5. Updated product direction: app open must not wait for first sync; prompt/session start shows percent progress.
6. Resolved for MVP: failed graph sync blocks agent work for that prompt and returns recoverable session error.
7. Resolved for MVP: first workflow is native agent definitions plus persisted runtime state and native workflow tools.
8. Resolved for MVP: persist BreakRequest, ContextCheckpoint, and ResumePackage; resume uses existing `task_id` sub-agent session continuation.
9. Still open: exact Apple Developer signing/notarization pipeline for release DMG.

Default answers until proven otherwise:

- Use bundled local CLI adapter until a stable library API is available.
- Use project-local `.codegraph/` for MVP.
- Use warning-mode fallback first, strict mode later.
- Reuse existing OpenCode service, tool, permission, and plugin hooks.

---

## 19. One-Line Summary

Ship `opencode-workflow` first through the macOS OpenCode Desktop `.dmg`: OpenCode opens normally, session start syncs embedded CodeGraph with visible percent progress, orchestrator-agent owns the workflow, native graph-first tools provide evidence, hard runtime approval gates block premature edits, persisted break/resume keeps sub-agent context, and remote URL skills are task-scoped leases; notarized release signing and full evidence UI remain gated by signing credentials and later UI work.
