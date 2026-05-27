import { Schema } from "effect"

export const CodeGraphStatus = Schema.Literals(["idle", "syncing", "ready", "stale", "failed"])
export type CodeGraphStatus = Schema.Schema.Type<typeof CodeGraphStatus>

export const WorkflowState = Schema.Literals([
  "intake",
  "codegraph_syncing",
  "exploring",
  "brainstorming",
  "planning",
  "plan_review",
  "plan_finalizing",
  "awaiting_plan_approval",
  "implementation",
  "code_review",
  "awaiting_done_approval",
  "awaiting_commit_approval",
  "done",
  "failed",
])
export type WorkflowState = Schema.Schema.Type<typeof WorkflowState>

export const WorkflowArtifactKind = Schema.Literals([
  "intake_spec",
  "backend_explore",
  "frontend_explore",
  "research_explore",
  "scope_decision",
  "plan_draft",
  "plan_review",
  "final_plan",
  "implementation",
  "backend_implementation",
  "frontend_implementation",
  "code_review",
  "done_approval",
  "commit_approval",
  "skillopt_review",
])
export type WorkflowArtifactKind = Schema.Schema.Type<typeof WorkflowArtifactKind>

export const WorkflowVariant = Schema.Literals(["lite", "full"])
export type WorkflowVariant = Schema.Schema.Type<typeof WorkflowVariant>

export const WorkflowReviewStatus = Schema.Literals(["approved", "no_findings", "needs_fix", "blocked"])
export type WorkflowReviewStatus = Schema.Schema.Type<typeof WorkflowReviewStatus>

export const WorkflowArtifact = Schema.Struct({
  id: Schema.String,
  kind: WorkflowArtifactKind,
  cycle: Schema.Int,
  agent: Schema.String,
  timestamp: Schema.String,
  summary: Schema.String,
  data: Schema.optional(Schema.Unknown),
  evidenceIds: Schema.Array(Schema.String),
  expectedChangedFiles: Schema.optional(Schema.Array(Schema.String)),
  reviewStatus: Schema.optional(WorkflowReviewStatus),
  variant: Schema.optional(WorkflowVariant),
})
export type WorkflowArtifact = Schema.Schema.Type<typeof WorkflowArtifact>

export const BreakRequest = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  taskSlice: Schema.String,
  reason: Schema.String,
  question: Schema.String,
  options: Schema.optional(Schema.Array(Schema.String)),
  evidenceIds: Schema.Array(Schema.String),
})
export type BreakRequest = Schema.Schema.Type<typeof BreakRequest>

export const ContextCheckpoint = Schema.Struct({
  breakRequestId: Schema.String,
  sessionId: Schema.String,
  subagentSessionId: Schema.String,
  workflowState: WorkflowState,
  taskBrief: Schema.String,
  evidenceIds: Schema.Array(Schema.String),
  compactedContext: Schema.String,
})
export type ContextCheckpoint = Schema.Schema.Type<typeof ContextCheckpoint>

export const ResumePackage = Schema.Struct({
  breakRequestId: Schema.String,
  answer: Schema.String,
  checkpoint: ContextCheckpoint,
  resumeInstruction: Schema.String,
})
export type ResumePackage = Schema.Schema.Type<typeof ResumePackage>

export const EvidenceEvent = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals([
    "graph_sync",
    "graph_query",
    "raw_fallback",
    "approval",
    "break",
    "resume",
    "impact",
    "test",
    "skill_lease",
    "skillopt_proposal",
  ]),
  timestamp: Schema.String,
  summary: Schema.String,
  data: Schema.optional(Schema.Unknown),
})
export type EvidenceEvent = Schema.Schema.Type<typeof EvidenceEvent>
