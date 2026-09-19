/**
 * Fork workspace view, left dock: the project file tree plus multi-tab
 * editable file views. Selecting text inside a tab shows a floating "add to
 * AI" button that references the file and line range in the composer. Chat
 * lives to the right of this dock (see session.tsx).
 */
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Button } from "@opencode-ai/ui/button"
import { Dynamic, Portal } from "solid-js/web"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import FileTreeV2 from "@/components/file-tree-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"

type Tab = {
  path: string
  name: string
  content: string
  saved: string
}

export function WorkspaceLeftDock(): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const fileComponent = useFileComponent()
  const sdk = useSDK()
  const prompt = usePrompt()
  const [tabs, setTabs] = createSignal<Tab[]>([])
  const [activePath, setActivePath] = createSignal<string>()
  const [floatBox, setFloatBox] = createSignal<{ x: number; y: number }>()
  const [floatRange, setFloatRange] = createSignal<{ start: number; end: number }>()

  const activeTab = createMemo(() => tabs().find((tab) => tab.path === activePath()))
  const dirty = createMemo(() => {
    const tab = activeTab()
    return !!tab && tab.content !== tab.saved
  })

  const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path

  const open = async (path: string) => {
    setActivePath(path)
    if (tabs().some((tab) => tab.path === path)) return
    await file.load(path)
    const raw = file.get(path)?.content
    const content = typeof raw === "string" ? raw : (typeof raw?.content === "string" ? raw.content : "")
    setTabs((list) => (list.some((tab) => tab.path === path) ? list : [...list, { path, name: fileName(path), content, saved: content }]))
  }

  const closeTab = (path: string) => {
    setTabs((list) => {
      const next = list.filter((tab) => tab.path !== path)
      if (activePath() === path) setActivePath(next.length > 0 ? next[next.length - 1].path : undefined)
      return next
    })
  }

  const setContent = (content: string) => {
    setTabs((list) => list.map((tab) => (tab.path === activePath() ? { ...tab, content } : tab)))
  }

  const save = async () => {
    const tab = activeTab()
    if (!tab) return
    try {
      await sdk().client.v2.fs.write({ location: { directory: sdk().directory }, path: tab.path, content: tab.content })
      setTabs((list) => list.map((item) => (item.path === tab.path ? { ...item, saved: item.content } : item)))
      void file.load(tab.path, { force: true })
      showToast({ variant: "success", title: language.t("workspace.saved.toast") })
    } catch {
      showToast({ variant: "error", title: language.t("workspace.saved.error") })
    }
  }

  // Text selection inside the editable tab: track the range and the mouse
  // position so a floating "add to AI" button can appear next to the cursor.
  const selectionRange = () => {
    const element = document.querySelector("textarea[data-workspace-edit]")
    if (!(element instanceof HTMLTextAreaElement)) return undefined
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0
    if (start === end) return undefined
    return { start, end }
  }

  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault()
      void save()
      return
    }
    if (event.key === "Escape") {
      setFloatBox(undefined)
      setFloatRange(undefined)
    }
  }

  const onMouseUp = (event: MouseEvent) => {
    const range = selectionRange()
    if (range) {
      setFloatRange(range)
      setFloatBox({ x: event.clientX, y: event.clientY })
    } else {
      setFloatBox(undefined)
      setFloatRange(undefined)
    }
  }

  const addSelectionToAI = () => {
    const tab = activeTab()
    const range = floatRange()
    if (!tab || !range) return
    const selectedText = tab.content.slice(range.start, range.end)
    const startLine = tab.content.slice(0, range.start).split("\n").length
    const endLine = startLine + selectedText.split("\n").length - 1
    prompt.context.add({
      type: "file",
      path: tab.path,
      selection: { startLine, startChar: 0, endLine, endChar: 0 },
      preview: selectedText.slice(0, 400),
    })
    setFloatBox(undefined)
    setFloatRange(undefined)
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-1 min-w-0 bg-background-base">
      <div
        class="h-full min-h-0 w-[240px] shrink-0 overflow-y-auto no-scrollbar border-e border-border-weaker-base"
        data-component="workspace-file-tree"
      >
        <FileTreeV2 onFileClick={(node) => void open(node.path)} />
      </div>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-base">
        <Show
          when={activeTab()}
          fallback={
            <div class="flex flex-1 items-center justify-center text-13-regular text-text-weak">
              {language.t("workspace.selectFile")}
            </div>
          }
        >
          {(tab) => (
            <>
              <div class="flex shrink-0 items-center gap-1 overflow-x-auto no-scrollbar border-b border-border-weaker-base px-1 pt-1">
                <For each={tabs()}>
                  {(item) => (
                    <div
                      class="flex max-w-[160px] shrink-0 cursor-pointer items-center gap-1 rounded-t-md px-2 py-1 text-12-regular hover:bg-surface-raised-base-hover"
                      classList={{
                        "bg-background-stronger text-text-strong": activePath() === item.path,
                        "text-text-weak": activePath() !== item.path,
                      }}
                      onClick={() => setActivePath(item.path)}
                    >
                      <span class="truncate">{item.name}</span>
                      <Show when={item.content !== item.saved}>
                        <span class="text-icon-base">●</span>
                      </Show>
                      <span
                        class="text-text-weak hover:text-text-strong"
                        onClick={(event) => {
                          event.stopPropagation()
                          closeTab(item.path)
                        }}
                      >
                        ×
                      </span>
                    </div>
                  )}
                </For>
                <div class="flex-1" />
                <Button size="small" disabled={!dirty()} onClick={save}>
                  {language.t("workspace.save")}
                </Button>
              </div>
              <textarea
                data-workspace-edit
                class="min-h-0 w-full flex-1 resize-none bg-background-base p-3 font-mono text-13-regular text-text-strong outline-none select-text"
                value={tab().content}
                onInput={(e) => setContent(e.currentTarget.value)}
                onKeyDown={onKeyDown}
                onMouseUp={onMouseUp}
                spellcheck={false}
              />
            </>
          )}
        </Show>
      </div>
      <Show when={floatBox() && floatRange()}>
        <Portal>
          <div
            class="fixed z-50 flex items-center gap-1 rounded-md border border-border-weaker-base bg-background-stronger p-1 shadow-lg"
            style={{
              left: `${Math.min(floatBox()!.x, window.innerWidth - 140)}px`,
              top: `${Math.max(8, floatBox()!.y - 40)}px`,
            }}
          >
            <Button size="small" onClick={addSelectionToAI}>
              {language.t("workspace.addToAI")}
            </Button>
          </div>
        </Portal>
      </Show>
    </div>
  )
}
