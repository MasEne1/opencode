/**
 * Fork workspace view, left dock: the project file tree plus a read/edit view
 * of the selected file, and "reference selection" into the AI composer. Chat
 * lives to the right of this dock (see session.tsx).
 */
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Button } from "@opencode-ai/ui/button"
import { Dynamic } from "solid-js/web"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { createMemo, createSignal, Match, Show, Switch, type JSX } from "solid-js"
import FileTreeV2 from "@/components/file-tree-v2"
import { selectionFromLines, useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { showToast } from "@/utils/toast"

export function WorkspaceLeftDock(): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const fileComponent = useFileComponent()
  const sdk = useSDK()
  const prompt = usePrompt()
  const [selected, setSelected] = createSignal<string>()
  const [selection, setSelection] = createSignal<SelectedLineRange | null>(null)
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")

  const state = createMemo(() => (selected() ? file.get(selected()!) : undefined))
  const contents = createMemo(() => {
    const raw = state()?.content
    return typeof raw === "string" ? raw : (typeof raw?.content === "string" ? raw.content : "")
  })

  const open = (path: string) => {
    setSelected(path)
    setSelection(null)
    setEditing(false)
    setDraft("")
    void file.load(path)
  }

  const onLineSelected = (range: SelectedLineRange | null) => {
    setSelection(range ? cloneSelectedLineRange(range) : null)
  }

  const referenceSelection = () => {
    const path = selected()
    const range = selection()
    if (!path || !range) return
    prompt.context.add({
      type: "file",
      path,
      selection: selectionFromLines(range),
      preview: previewSelectedLines(contents(), { start: range.start, end: range.end }),
    })
    setSelection(null)
  }

  const startEdit = () => {
    setDraft(contents())
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft("")
  }

  const save = () => {
    const path = selected()
    if (!path) return
    void sdk()
      .client.v2.fs.write({ location: { directory: sdk().directory }, path, content: draft() })
      .then(() => {
        setEditing(false)
        setDraft("")
        return file.load(path, { force: true })
      })
      .then(() => {
        showToast({ variant: "success", title: language.t("workspace.saved.toast") })
      })
      .catch(() => {
        showToast({ variant: "error", title: language.t("workspace.saved.error") })
      })
  }

  const selectionLabel = () => {
    const range = selection()
    if (!range) return language.t("workspace.reference.selection")
    if (range.start === range.end) return language.t("workspace.reference.line").replace("{line}", String(range.start))
    return language.t("workspace.reference.lines")
      .replace("{start}", String(range.start))
      .replace("{end}", String(range.end))
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-1 min-w-0 bg-background-base">
      <div
        class="h-full min-h-0 w-[240px] shrink-0 overflow-y-auto no-scrollbar border-e border-border-weaker-base"
        data-component="workspace-file-tree"
      >
        <FileTreeV2
          onFileClick={(node) => open(node.path)}
          onFileDoubleClick={(node) => open(node.path)}
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-base">
        <div class="flex shrink-0 items-center gap-2 border-b border-border-weaker-base px-3 py-1.5">
          <span class="min-w-0 flex-1 truncate text-12-medium text-text-base">{selected()}</span>
          <Show when={selected() && selection()}>
            <Button size="small" onClick={referenceSelection}>
              {selectionLabel()}
            </Button>
          </Show>
          <Show
            when={editing()}
            fallback={
              <Show when={selected()}>
                <Button size="small" variant="secondary" onClick={startEdit}>
                  {language.t("workspace.edit")}
                </Button>
              </Show>
            }
          >
            <Button size="small" onClick={save}>
              {language.t("workspace.save")}
            </Button>
            <Button size="small" variant="secondary" onClick={cancelEdit}>
              {language.t("workspace.cancel")}
            </Button>
          </Show>
        </div>
        <Show
          when={editing()}
          fallback={
            <ScrollView class="min-h-0 flex-1">
              <Switch>
                <Match when={state()?.loading}>
                  <div class="px-4 py-3 text-12-regular text-text-weak">
                    {language.t("common.loading")}
                    {language.t("common.loading.ellipsis")}
                  </div>
                </Match>
                <Match when={state()?.error}>
                  {(err) => <div class="px-4 py-3 text-12-regular text-text-weak">{err()}</div>}
                </Match>
              </Switch>
              <Show when={state()?.loaded}>
                {(() => {
                  const path = selected()!
                  const raw = file.get(path)?.content
                  const contents = typeof raw === "string" ? raw : (typeof raw?.content === "string" ? raw.content : "")
                  if (raw?.type === "binary") {
                    return (
                      <div class="px-4 py-3 text-12-regular text-text-weak">
                        {language.t("workspace.binaryFile")}
                      </div>
                    )
                  }
                  return (
                    <div class="relative pb-40">
                      <Dynamic
                        component={fileComponent}
                        mode="text"
                        file={{
                          name: path,
                          contents,
                          cacheKey: sampledChecksum(contents),
                        }}
                        enableLineSelection
                        selectedLines={selection() ?? undefined}
                        onLineSelected={onLineSelected}
                        onLineSelectionEnd={onLineSelected}
                        class="select-text"
                      />
                    </div>
                  )
                })()}
              </Show>
            </ScrollView>
          }
        >
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
            <textarea
              class="h-full min-h-0 w-full flex-1 resize-none rounded-lg bg-background-stronger p-3 font-mono text-13-regular text-text-strong outline-none"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              spellcheck={false}
            />
          </div>
        </Show>
      </div>
    </div>
  )
}
