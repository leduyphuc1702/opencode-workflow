import { Identifier } from "@/id/id"
import { SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { EvidenceEvent } from "./protocol"

export type CreateInput = {
  sessionID: SessionID
  type: EvidenceEvent["type"]
  summary: string
  data?: unknown
}

export interface Interface {
  readonly append: (input: CreateInput) => Effect.Effect<EvidenceEvent>
  readonly list: (sessionID: SessionID) => Effect.Effect<readonly EvidenceEvent[]>
  readonly get: (input: { sessionID: SessionID; id: string }) => Effect.Effect<EvidenceEvent | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkflowEvidence") {}

const Events = Schema.Array(EvidenceEvent)
const decodeEvents = Schema.decodeUnknownOption(Events)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service

    const list: Interface["list"] = Effect.fn("WorkflowEvidence.list")(function* (sessionID) {
      const raw = yield* storage.read<unknown>(key(sessionID)).pipe(
        Effect.catchTag("NotFoundError", () => Effect.succeed([])),
        Effect.orDie,
      )
      const decoded = decodeEvents(raw, { onExcessProperty: "preserve" })
      if (Option.isSome(decoded)) return decoded.value
      return []
    })

    const append: Interface["append"] = Effect.fn("WorkflowEvidence.append")(function* (input) {
      const event: EvidenceEvent = {
        id: Identifier.create("evd", "ascending"),
        type: input.type,
        timestamp: new Date().toISOString(),
        summary: input.summary,
        data: input.data,
      }
      yield* storage.write(key(input.sessionID), [...(yield* list(input.sessionID)), event]).pipe(Effect.orDie)
      return event
    })

    const get: Interface["get"] = Effect.fn("WorkflowEvidence.get")(function* (input) {
      return (yield* list(input.sessionID)).find((event) => event.id === input.id)
    })

    return Service.of({ append, list, get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Storage.defaultLayer))

function key(sessionID: SessionID) {
  return ["workflow_evidence", sessionID]
}

export * as WorkflowEvidence from "./evidence"
