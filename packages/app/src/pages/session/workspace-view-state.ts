import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export function createWorkspaceViewState() {
  const [store, setStore] = persisted(
    Persist.global("workspace-view"),
    createStore({
      opened: false,
      fontSize: 13,
    }),
  )
  return {
    opened: () => store.opened,
    toggle: () => setStore("opened", (opened) => !opened),
    open: () => setStore("opened", true),
    close: () => setStore("opened", false),
    fontSize: () => store.fontSize,
    setFontSize: (size: number) => setStore("fontSize", Math.max(10, Math.min(28, Math.round(size)))),
  }
}

export type WorkspaceViewState = ReturnType<typeof createWorkspaceViewState>

let singleton: WorkspaceViewState | undefined

/** Module-level accessor so the session page, commands, and settings share one state. */
export function workspaceView() {
  return (singleton ??= createWorkspaceViewState())
}
