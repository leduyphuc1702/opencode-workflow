import { Schema } from "effect"
import { SessionID } from "../session/schema"

// Task IDs are hierarchical: T1, T1.1, T1.2.3 ... The registry generates them;
// the schema keeps them as plain strings (the format is enforced by nextChildId).
export const TaskID = Schema.String
export type TaskID = string

export const TaskStatus = Schema.Literals(["open", "in_progress", "blocked", "done", "abandoned"])
export type TaskStatus = Schema.Schema.Type<typeof TaskStatus>

export const Task = Schema.Struct({
  id: Schema.String,
  session_id: SessionID,
  parent_task_id: Schema.optional(Schema.String),
  status: TaskStatus,
  summary: Schema.String,
  owner: Schema.optional(Schema.String),
  created_at: Schema.Number,
  last_event_at: Schema.Number,
  ended_at: Schema.optional(Schema.Number),
  cleanup_after: Schema.optional(Schema.Number),
})
export type Task = Schema.Schema.Type<typeof Task>

export const TaskEventKind = Schema.Literals([
  "created",
  "started",
  "unstarted",
  "blocked",
  "unblocked",
  "done",
  "abandoned",
  "renamed",
])
export type TaskEventKind = Schema.Schema.Type<typeof TaskEventKind>

export const TaskEvent = Schema.Struct({
  id: Schema.Number,
  task_id: Schema.String,
  at: Schema.Number,
  kind: TaskEventKind,
  summary: Schema.optional(Schema.String),
})
export type TaskEvent = Schema.Schema.Type<typeof TaskEvent>
