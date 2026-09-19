/**
 * Fork workspace view, left dock: the project file tree plus multi-tab
 * CodeMirror editors (syntax highlighted, editable). Selecting text shows a
 * floating "add to AI" button that references the file and line range in the
 * composer. Chat lives to the right of this dock (see session.tsx).
 */
import { Button } from "@opencode-ai/ui/button"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Compartment, EditorState, type Extension } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { cpp } from "@codemirror/lang-cpp"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { javascript } from "@codemirror/lang-javascript"
import { oneDark } from "@codemirror/theme-one-dark"
import { basicSetup, EditorView as CMView } from "codemirror"
import { onMount } from "solid-js"
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
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

const langConf = new Compartment()
const lineSeparator = String.fromCharCode(10)

function languageExtensionFor(path: string): Extension {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "py") return python()
  if (["jsx", "mjs", "cjs"].includes(ext)) return javascript({ jsx: true })
  if (["ts", "tsx"].includes(ext)) return javascript({ typescript: true, jsx: true })
  if (["cpp", "cc", "cxx", "hpp", "h", "hh"].includes(ext)) return cpp()
  if (ext === "json") return json()
  if (["md", "markdown"].includes(ext)) return markdown()
  return []
}

export function WorkspaceLeftDock(): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const sdk = useSDK()
  const prompt = usePrompt()
  const [tabs, setTabs] = createSignal<Tab[]>([])
  const [activePath, setActivePath] = createSignal<string>()
  const [floatBox, setFloatBox] = createSignal<{ x: number; y: number }>()
  const [floatRange, setFloatRange] = createSignal<{ start: number; end: number }>()
  let host: HTMLDivElement | undefined
  let view: CMView | undefined

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

  onMount(() => {
    const updateListener = CMView.updateListener.of((update) => {
      if (!view) return
      if (update.docChanged) {
        const path = activePath()
        if (path) setContent(update.state.doc.toString())
      }
      if (update.selectionSet) {
        const selection = update.state.selection.main
        if (selection.from === selection.to) {
          setFloatBox(undefined)
          setFloatRange(undefined)
          return
        }
        const coords = view.coordsAtPos(selection.head)
        if (coords) setFloatBox({ x: coords.left, y: coords.top })
        setFloatRange({ start: selection.from, end: selection.to })
      }
    })
    view = new CMView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: [
          basicSetup,
          oneDark,
          langConf.of([]),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                void save()
                return true
              },
            },
          ]),
          updateListener,
        ],
      }),
    })
  })

  // Swap the editor document and language when the active tab changes.
  createEffect(() => {
    const tab = activeTab()
    const editor = view
    if (!editor || !tab) return
    if (editor.state.doc.toString() === tab.content) return
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: tab.content },
    })
    langConf.reconfigure(languageExtensionFor(tab.path))
  })

  // "Add to AI": turn the editor selection into a file + line range reference
  // in the composer.
  const referenceSelection = () => {
    const tab = activeTab()
    const range = floatRange()
    if (!tab || !range) return
    const before = tab.content.slice(0, range.start)
    const selectedText = tab.content.slice(range.start, range.end)
    const startLine = before.split("\n").length
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

  const addSelectionToAI = () => {
    const tab = activeTab()
    const range = floatRange()
    if (!tab || !range) return
    const selectedText = tab.content.slice(range.start, range.end)
    const startLine = tab.content.slice(0, range.start).split(lineSeparator).length
    const endLine = startLine + selectedText.split(lineSeparator).length - 1
    prompt.context.add({
      type: "file",
      path: tab.path,
      selection: { startLine, startChar: 0, endLine, endChar: 0 },
      preview: selectedText.slice(0, 400),
    })
    setFloatBox(undefined)
    setFloatRange(undefined)
  }

  const selectionLabel = () => {
    const range = floatRange()
    if (!range) return language.t("workspace.reference.selection")
    if (range.start === range.end) return language.t("workspace.reference.line").replace("{line}", String(range.start + 1))
    return language.t("workspace.reference.lines")
      .replace("{start}", String(range.start + 1))
      .replace("{end}", String(range.end + 1))
  }

  return (
    <div class="flex h-full min-h-0 w-full flex-1 min-w-0 bg-background-base">
      <ScrollView class="h-full min-h-0 w-[240px] shrink-0 border-e border-border-weaker-base">
        <FileTreeV2 onFileClick={(node) => void open(node.path)} />
      </ScrollView>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-base">
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
        <div class="flex shrink-0 items-center gap-2 border-b border-border-weaker-base px-3 py-1.5">
          <span class="min-w-0 flex-1 truncate text-12-medium text-text-base">{activePath()}</span>
          <Show when={floatRange()}>
            <Button size="small" onClick={referenceSelection}>
              {selectionLabel()}
            </Button>
          </Show>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden" ref={(el) => (host = el)} />
      </div>
      <Portal>
        <Show when={floatBox() && floatRange()}>
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
        </Show>
      </Portal>
    </div>
  )
}
