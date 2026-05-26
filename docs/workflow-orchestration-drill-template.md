# Workflow Orchestration Drill Evidence Matrix

Use this template for golden orchestration drill reports. Every row should point
to concrete evidence, not an assumption. Use `none` for an explicit empty gap.

| Requirement | Artifact | Evidence | Verification | Status | Gap |
| --- | --- | --- | --- | --- | --- |
| CodeGraph evidence before PlanDraft | `codebase_context` or equivalent graph event | `evd_...` | Event order: graph evidence precedes PlanDraft | pass/fail | none or gap detail |
| PlanDraft before reviewer review | PlanDraft fixture or artifact | `evd_...` / `ses_...` | Reviewer input includes the real PlanDraft | pass/fail | none or gap detail |
| Missing artifact creates BreakRequest | `BreakRequest` + `ContextCheckpoint` | `brk_...` / `evd_...` | `workflow_break` output includes id, question, checkpoint, instruction | pass/fail | none or gap detail |
| Resume uses same sub-agent task id | `ResumePackage` | `task_id: ses_...` / `evd_...` | `checkpoint.subagentSessionId` equals resumed `task_id` | pass/fail | none or gap detail |
| Reviewer does not review assumptions | Reviewer result after resume | `evd_...` / `ses_...` | Review evidence references the PlanDraft artifact | pass/fail | none or gap detail |
| Finalizer emits complete matrix | Final drill report | `evd_...` | Matrix contains every hard requirement | pass/fail | none or gap detail |
| Remote skill lease hashes raw content | Skill lease evidence | `evd_...` | Evidence has `rawContentUrl`, `contentSha256`, and no install/persist status | pass/fail | none or gap detail |
| Verification is package-local | Test/typecheck output | command output | Commands run from `packages/opencode` | pass/fail | none or gap detail |

## Verification Commands

Run from `packages/opencode`:

```bash
bun test test/workflow
bun test test/tool/task.test.ts
bun test test/tool/skill.test.ts test/skill/discovery.test.ts
bun test test/tool/registry.test.ts
bun run test:httpapi
bun typecheck
```
