import { createMemo, For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

type SecurityLevel = "low" | "medium" | "high" | "irreversible"
type SecuritySecret = { type: string; line: string | number; redacted: string }
type SecurityMetadata = { level: SecurityLevel; reasons: string[]; secrets: SecuritySecret[] }

function securityMetadata(input: unknown): SecurityMetadata | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined

  const record = input as Record<string, unknown>
  if (!securityLevel(record.level)) return undefined

  return {
    level: record.level,
    reasons: Array.isArray(record.reasons) ? record.reasons.filter((reason): reason is string => typeof reason === "string") : [],
    secrets: Array.isArray(record.secrets)
      ? record.secrets.flatMap((secret): SecuritySecret[] => {
          if (!secret || typeof secret !== "object" || Array.isArray(secret)) return []
          const item = secret as Record<string, unknown>
          if (typeof item.type !== "string") return []
          if (typeof item.redacted !== "string") return []
          if (typeof item.line !== "string" && typeof item.line !== "number") return []
          return [{ type: item.type, line: item.line, redacted: item.redacted }]
        })
      : [],
  }
}

function securityLevel(input: unknown): input is SecurityLevel {
  return input === "low" || input === "medium" || input === "high" || input === "irreversible"
}

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const security = createMemo(() => securityMetadata(props.request.metadata?.security))

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={security()}>
        {(risk) => (
          <>
            <div data-slot="permission-row">
              <span data-slot="permission-icon" aria-hidden="true">
                <Icon name="warning" size="normal" />
              </span>
              <div data-slot="permission-hint">
                <span
                  class={
                    "text-12-medium " +
                    (risk().level === "high" || risk().level === "irreversible"
                      ? "text-text-on-critical-base"
                      : "text-icon-warning-active")
                  }
                >
                  {"Security [" + risk().level + "]"}
                </span>
                <Show when={risk().reasons.length > 0}>{" " + risk().reasons.join("; ")}</Show>
              </div>
            </div>
            <For each={risk().secrets}>
              {(secret) => (
                <div data-slot="permission-row">
                  <span data-slot="permission-spacer" aria-hidden="true" />
                  <div data-slot="permission-hint">{secret.type + " line " + secret.line + ": " + secret.redacted}</div>
                </div>
              )}
            </For>
          </>
        )}
      </Show>

      <Show when={props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
