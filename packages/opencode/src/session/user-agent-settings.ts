import { Option, Schema } from "effect"
import { MessageV2 } from "./message-v2"
import { ModelID, ProviderID } from "../provider/schema"

export type ModelRefInput = { providerID: ProviderID; modelID: ModelID }

export type Settings = {
  subagent_model_overrides?: Record<string, ModelRefInput | string>
  frontend_image_model?: ModelRefInput | string
}

export function read(lastUser: MessageV2.User): Settings {
  if (!lastUser.system) return {}
  return parseUserAgentSettings(lastUser.system)
}

export function modelRef(value: ModelRefInput | string | undefined): ModelRefInput | undefined {
  if (!value) return
  if (typeof value === "string") {
    const [providerID, ...model] = value.split("/")
    if (!providerID || model.length === 0) return
    return { providerID: ProviderID.make(providerID), modelID: ModelID.make(model.join("/")) }
  }
  if (!value.providerID || !value.modelID) return
  return value
}

function parseUserAgentSettings(text: string): Settings {
  const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(text)
  if (Option.isNone(parsed)) return {}
  return normalizeUserAgentSettings(parsed.value)
}

function normalizeUserAgentSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  if ("user_agent_settings" in value) return normalizeUserAgentSettings(value.user_agent_settings)
  return value as Settings
}

export * as UserAgentSettings from "./user-agent-settings"
