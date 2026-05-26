import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Schema } from "effect"
import { SessionID } from "@/session/schema"
import { WorkflowEvidence } from "@/workflow/evidence"
import { testEffect } from "../lib/effect"

const it = testEffect(WorkflowEvidence.defaultLayer)
const sessionID = Schema.decodeUnknownSync(SessionID)("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K")

describe("workflow.evidence", () => {
  it.effect("persists and lists session evidence events", () =>
    Effect.gen(function* () {
      const evidence = yield* WorkflowEvidence.Service

      const event = yield* evidence.append({
        sessionID,
        type: "graph_query",
        summary: "CodeGraph context",
        data: { tool: "codebase_context" },
      })

      expect(event.id.startsWith("evd_")).toBe(true)
      expect(typeof event.timestamp).toBe("string")

      const events = yield* evidence.list(sessionID)
      expect(events.map((item) => item.id)).toContain(event.id)
      expect(yield* evidence.get({ sessionID, id: event.id })).toEqual(event)
    }),
  )
})
