import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSync } from "@/context/server-sync"
import { useSettings, type AgentModelSetting } from "@/context/settings"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { ModelList } from "./dialog-select-model"
import { SettingsList } from "./settings-list"

type ListedModel = ReturnType<ReturnType<typeof useModels>["list"]>[number]
type PickerState =
  | { type: "agent"; agent: string; current: AgentModelSetting | undefined }
  | { type: "image"; current: AgentModelSetting | undefined }

const modelKey = (model: { providerID: string; modelID: string }) => `${model.providerID}/${model.modelID}`

const imageGenerationModel = (model: ListedModel) => {
  const item = model as ListedModel & { options?: { imageGeneration?: unknown } }
  return item.options?.imageGeneration !== undefined
}

export const SettingsAgents: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const settings = useSettings()
  const serverSync = useServerSync()
  const params = useParams()
  const [picker, setPicker] = createSignal<PickerState | undefined>()

  const directory = createMemo(() => decode64(params.dir) ?? "")
  const agents = createMemo(() => (directory() ? serverSync.child(directory())[0].agent : []))
  const modelPicker = {
    current: () => undefined,
    list: models.list,
    set: () => undefined,
    visible: models.visible,
  }

  const subagents = createMemo(() =>
    agents()
      .filter((agent) => agent.mode === "subagent" || agent.mode === "all")
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
  const imageModels = createMemo(() => models.list().filter(imageGenerationModel))
  const label = (value: AgentModelSetting | undefined) => {
    if (!value) return "Inherited"
    const found = models.find(value)
    return found ? `${found.provider.name} / ${found.name}` : modelKey(value)
  }
  const pickerTitle = () => {
    const current = picker()
    if (!current) return ""
    return current.type === "agent" ? `Choose model for ${current.agent}` : "Choose image model"
  }
  const pickerDescription = () => {
    const current = picker()
    if (!current) return ""
    return current.type === "agent" ? "Set this sub-agent override." : "Set the frontend-agent image model."
  }
  const pickModel = (model: { providerID: string; modelID: string }) => {
    const current = picker()
    if (!current) return
    if (current.type === "agent") settings.agents.setModelOverride(current.agent, { ...model })
    if (current.type === "image") settings.agents.setFrontendImageModel({ ...model })
    setPicker(undefined)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-2 pt-6 pb-6 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.agents.title")}</h2>
          <p class="text-13-regular text-text-weak">Configure sub-agent model overrides and frontend image generation.</p>
        </div>
      </div>

      <Show
        when={picker()}
        fallback={
          <div class="flex flex-col gap-8 max-w-[720px]">
            <div class="flex flex-col gap-2">
              <h3 class="text-14-medium text-text-strong">Sub-agent model overrides</h3>
              <SettingsList>
                <Show
                  when={subagents().length > 0}
                  fallback={<div class="py-3 text-14-regular text-text-weak">No sub-agents found.</div>}
                >
                  <For each={subagents()}>
                    {(agent) => {
                      const current = () => settings.agents.modelOverrides()[agent.name]
                      return (
                        <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                          <div class="min-w-0">
                            <span class="text-14-regular text-text-strong truncate block">{agent.name}</span>
                            <span class="text-13-regular text-text-weak truncate block">{label(current())}</span>
                          </div>
                          <div class="flex items-center gap-1 flex-shrink-0">
                            <Button
                              size="small"
                              variant="ghost"
                              onClick={() => setPicker({ type: "agent", agent: agent.name, current: current() })}
                            >
                              Select model
                            </Button>
                            <Show when={current()}>
                              <IconButton
                                icon="circle-x"
                                variant="ghost"
                                aria-label="Clear model override"
                                onClick={() => settings.agents.setModelOverride(agent.name, undefined)}
                              />
                            </Show>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </Show>
              </SettingsList>
            </div>

            <div class="flex flex-col gap-2">
              <h3 class="text-14-medium text-text-strong">Frontend-agent image generation model</h3>
              <SettingsList>
                <div class="flex flex-wrap items-center justify-between gap-4 py-3">
                  <div class="min-w-0">
                    <span class="text-14-regular text-text-strong truncate block">Image model</span>
                    <span class="text-13-regular text-text-weak truncate block">
                      {label(settings.agents.frontendImageModel())}
                    </span>
                  </div>
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <Show when={settings.agents.frontendImageModel()}>
                      {(current) => <ProviderIcon id={current().providerID} class="size-5 shrink-0 icon-strong-base" />}
                    </Show>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={imageModels().length === 0}
                      onClick={() => setPicker({ type: "image", current: settings.agents.frontendImageModel() })}
                    >
                      Select image model
                    </Button>
                    <Show when={settings.agents.frontendImageModel()}>
                      <IconButton
                        icon="circle-x"
                        variant="ghost"
                        aria-label="Clear frontend image model"
                        onClick={() => settings.agents.setFrontendImageModel(undefined)}
                      />
                    </Show>
                  </div>
                </div>
              </SettingsList>
            </div>
          </div>
        }
      >
        {(activePicker) => (
          <div class="flex flex-col gap-3 max-w-[720px] min-h-[480px]">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <h3 class="text-14-medium text-text-strong truncate">{pickerTitle()}</h3>
                <p class="text-13-regular text-text-weak truncate">{pickerDescription()}</p>
              </div>
              <Button size="small" variant="ghost" icon="arrow-left" onClick={() => setPicker(undefined)}>
                Back
              </Button>
            </div>
            <div class="h-[min(560px,calc(100vh-260px))] min-h-[360px] rounded-lg bg-surface-base px-3 py-3">
              <ModelList
                class="h-full flex flex-col [&_[data-slot=list-search-wrapper]]:mb-3 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 [&_[data-slot=list-scroll]]:overflow-y-auto"
                model={modelPicker}
                current={activePicker().current}
                filter={activePicker().type === "image" ? imageGenerationModel : undefined}
                onPick={pickModel}
                onSelect={() => setPicker(undefined)}
              />
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
