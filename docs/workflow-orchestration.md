# opencode-workflow orchestration contract

This contract keeps workflow sessions evidence-first, simple, and reviewable.

## Required sequence

1. Intake the request.
2. Check CodeGraph status and gather CodeGraph evidence for structural context.
3. Ask `plan-agent` for a PlanDraft.
4. Ask `plan-reviewer` to review the real PlanDraft.
5. Synthesize the FinalPlan.
6. Get explicit user approval with `workflow_approve_plan`.
7. Implement only the approved scope.
8. Run code review.
9. Verify from the package directory.

Do not run `plan-reviewer` in parallel with `plan-agent` when the reviewer needs
the PlanDraft. If the reviewer is missing a PlanDraft, diff, test result, or other
concrete artifact, it must call `workflow_break` instead of reviewing assumptions.

## Sub-agent operating contract

Every workflow sub-agent must follow four principles:

1. **Think Before Coding** — state assumptions, do not guess, and surface tradeoffs.
2. **Simplicity First** — prefer the smallest safe change over speculative flexibility.
3. **Surgical Changes** — touch only files that directly map to the request.
4. **Goal-Driven Execution** — define success criteria and verification before claiming completion.

Sub-agents must not ask the user directly. When blocked, they emit a
`workflow_break` with the blocked slice, reason, exact question, supporting
evidence ids, and compacted context.

## Break/resume contract

`workflow_break` creates a `BreakRequest` and `ContextCheckpoint`.
`workflow_resume_break` creates a `ResumePackage` that the orchestrator passes
back to the same sub-agent with the returned `task_id`.

The checkpoint must preserve enough context to resume without restarting:

- workflow session id;
- sub-agent session id;
- task brief;
- evidence ids;
- compacted context.

## Skill discipline

Use local skills only when they match the task. Remote skills are task-scoped
leases: record the source, hash, decision, and evidence; do not install or
promote them permanently unless the user explicitly asks.

## Evidence matrix

Final reports for non-trivial workflow work should include:

| Requirement | File/Test/Doc | Verification | Evidence |
| --- | --- | --- | --- |
| CodeGraph-first | CodeGraph context/status | CodeGraph evidence id | `evd_...` |
| Plan before review | PlanDraft then reviewer result | sub-agent task ids | `ses_...` |
| Four principles | prompt/docs/test | workflow tests | command output |
| Break/resume | protocol/runtime test | `bun test test/workflow` | command output |
| Verification before complete | test/typecheck | package-local commands | command output |

## Verification commands

Run tests from `packages/opencode`, never from the repository root:

```bash
bun test test/tool/registry.test.ts
bun test test/workflow
bun typecheck
```

Do not claim completion if verification did not run. State the blocker instead.
