<!-- Built-in opencode-workflow skill. Registered in packages/opencode/src/skill/index.ts. -->

# opencode-workflow

Use this skill for the bundled OpenCode Workflow runtime.

## Policy

- CodeGraph is the default codebase intelligence path.
- Do not ask users to install MCP, a global `codegraph`, or copy workflow skills.
- The app opens normally; when a new working session starts, wait for CodeGraph init/sync to finish before planning or implementation.
- Treat `.codegraph/` in the project root as the workflow database.
- Use raw grep/read/glob only as a justified fallback when CodeGraph cannot answer the specific detail.
- Prefer native tools: `codebase_status`, `codebase_files`, `codebase_context`, `codebase_search_symbol`, `codebase_callers`, `codebase_callees`, `codebase_node`, `codebase_trace`, `codebase_explore`, `codebase_impact`, and `codebase_affected_tests`.
- Remote skills from `skills.sh` are task-scoped leases only. Remote skills are not listed in `available_skills`; if one is explicitly loaded, the skill tool records hash, source, decision, and evidence for the current task. Do not promote them into a long-lived registry.
- Use `workflow_state`, `workflow_approve_plan`, `workflow_break`, and `workflow_resume_break` for runtime-backed workflow state, approval, and break/resume.

## Workflow

The orchestrator owns user interaction and enforces this state machine:

`intake -> codegraph_syncing -> brainstorming -> planning -> plan_review -> awaiting_plan_approval -> implementation -> code_review -> done`

Implementation cannot start until the user explicitly approves the final plan and `workflow_approve_plan` succeeds.

## Sub-Agent Contract

Sub-agents never ask the user directly. When blocked, call `workflow_break` to emit a `BreakRequest`:

```json
{
  "id": "break_<stable-id>",
  "agent": "<sub-agent-name>",
  "taskSlice": "<the blocked slice>",
  "reason": "<why progress stopped>",
  "question": "<single question for the user>",
  "options": ["optional short option"],
  "evidenceIds": ["graph-query-or-file-evidence"]
}
```

The runtime/orchestrator stores a `ContextCheckpoint`, asks the user, then calls `workflow_resume_break` to create a `ResumePackage` and resumes the same sub-agent session via `task_id`:

```json
{
  "breakRequestId": "<same id>",
  "answer": "<user answer>",
  "checkpoint": "<saved checkpoint>",
  "resumeInstruction": "<specific continuation instruction>"
}
```

## Evidence Events

Record evidence for graph sync, graph query, raw fallback, approval, break, resume, impact analysis, tests, and task-scoped remote skill leases.
