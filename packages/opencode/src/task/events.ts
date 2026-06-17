import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
import { Task } from "./schema"

export const Created = BusEvent.define(
  "task.created",
  Schema.Struct({
    sessionID: SessionID,
    task: Task,
  }),
)

// `kind` narrows the lifecycle transition that produced this event. `created`
// is excluded — new rows ride [[Created]] so external consumers can split
// "row appeared" from "row mutated" without an if-kind branch (matching
// actor.registered vs actor.status). Effect Schema has no `.exclude`, so the
// non-created kinds are listed explicitly.
export const UpdatedKind = Schema.Literals([
  "started",
  "unstarted",
  "blocked",
  "unblocked",
  "done",
  "abandoned",
  "renamed",
])
export type UpdatedKind = Schema.Schema.Type<typeof UpdatedKind>

export const Updated = BusEvent.define(
  "task.updated",
  Schema.Struct({
    sessionID: SessionID,
    task: Task,
    kind: UpdatedKind,
  }),
)
