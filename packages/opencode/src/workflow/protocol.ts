import { Schema } from "effect"

export const CodeGraphStatus = Schema.Literals(["idle", "syncing", "ready", "stale", "failed"])
export type CodeGraphStatus = Schema.Schema.Type<typeof CodeGraphStatus>

export const WorkflowState = Schema.Literals([
  "intake",
  "codegraph_syncing",
  "brainstorming",
  "planning",
  "plan_review",
  "awaiting_plan_approval",
  "implementation",
  "code_review",
  "done",
  "failed",
])
export type WorkflowState = Schema.Schema.Type<typeof WorkflowState>

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
  ]),
  timestamp: Schema.String,
  summary: Schema.String,
  data: Schema.optional(Schema.Unknown),
})
export type EvidenceEvent = Schema.Schema.Type<typeof EvidenceEvent>
