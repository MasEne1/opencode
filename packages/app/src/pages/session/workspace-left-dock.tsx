/**
 * Fork workspace view, left dock: the project file tree plus a read-only
 * preview of the selected file. Chat lives to the right of this dock (see
 * session.tsx).
 */
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Dynamic } from "solid-js/web"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { createMemo, createSignal, Match, Show, Switch, type JSX } from "solid-js"
import FileTreeV2 from "@/components/file-tree-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"

export function WorkspaceLeftDock(): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const fileComponent = useFileComponent()
  const [selected, setSelected] = createSignal<string>()

  const state = createMemo(() => (selected() ? file.get(selected()!) : undefined))

  const open = (path: string) => {
    setSelected(path)
    void file.load(path)
  }

  return (
    <div class="flex h-full min-h-0 w-[560px] shrink-0">
      <div
        class="h-full min-h-0 w-[240px] shrink-0 overflow-y-auto no-scrollbar border-e border-border-weaker-base"
        data-component="workspace-file-tree"
      >
        <FileTreeV2
          onFileClick={(node) => open(node.path)}
          onFileDoubleClick={(node) => open(node.path)}
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Show
          when={selected()}
          fallback={
            <div class="flex flex-1 items-center justify-center px-4 text-center text-13-regular text-text-weak">
              {language.t("workspace.selectFile")}
            </div>
          }
        >
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div class="truncate border-b border-border-weaker-base px-3 py-1.5 text-12-medium text-text-base">
              {selected()}
            </div>
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
                        class="select-text"
                      />
                    </div>
                  )
                })()}
              </Show>
            </ScrollView>
          </div>
        </Show>
      </div>
      <span class="hidden" />
    </div>
  )
}
