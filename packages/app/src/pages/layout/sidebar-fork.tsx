/**
 * Fork-only sidebar redesign: task menu (new task / search) + "分组 / 项目"
 * tabs. The upstream SidebarContent/SidebarPanel stay untouched; this component
 * only replaces their usage in pages/layout.tsx so upstream merges stay clean.
 */
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { SegmentedControlV2, SegmentedControlItemV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { type Accessor, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { displayName, getProjectAvatarSource } from "./helpers"
import { SessionItem } from "./sidebar-items"
import { LocalWorkspace, type WorkspaceSidebarContext } from "./sidebar-workspace"

type TimeBucket = "today" | "yesterday" | "week" | "older"

function timeBucket(timestamp: number, now: number): TimeBucket {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.getTime()
  if (timestamp >= today) return "today"
  if (timestamp >= today - 86_400_000) return "yesterday"
  if (timestamp >= today - 7 * 86_400_000) return "week"
  return "older"
}

const BUCKET_ORDER: TimeBucket[] = ["today", "yesterday", "week", "older"]

export interface SidebarForkProps {
  mobile?: boolean
  projects: Accessor<LocalProject[]>
  currentProject: Accessor<LocalProject | undefined>
  currentSessions: Accessor<Session[]>
  ctx: WorkspaceSidebarContext
  sortNow: Accessor<number>
  onNewSession: () => void
  newTaskKeybind: Accessor<string | undefined>
  onOpenSearch: () => void
  searchKeybind: Accessor<string | undefined>
  onOpenProject: () => void
  onOpenProjectDirectory: (project: LocalProject) => void
  onOpenSettings: () => void
  settingsKeybind: Accessor<string | undefined>
  onOpenHelp: () => void
}

export const SidebarFork = (props: SidebarForkProps): JSX.Element => {
  const language = useLanguage()
  const [tab, setTab] = createSignal<"groups" | "projects">("projects")
  const [expanded, setExpanded] = createSignal<string[]>([])
  const now = props.sortNow

  const currentSlug = createMemo(() => {
    const dir = props.currentProject()?.worktree
    return dir ? base64Encode(dir) : ""
  })

  const isExpanded = (worktree: string) => expanded().includes(worktree)
  const toggleExpanded = (worktree: string) =>
    setExpanded((list) => (list.includes(worktree) ? list.filter((item) => item !== worktree) : [...list, worktree]))

  const grouped = createMemo(() => {
    const titles: Record<TimeBucket, string> = {
      today: language.t("sidebar.fork.group.today"),
      yesterday: language.t("sidebar.fork.group.yesterday"),
      week: language.t("sidebar.fork.group.week"),
      older: language.t("sidebar.fork.group.older"),
    }
    const buckets = new Map<TimeBucket, Session[]>()
    for (const session of props.currentSessions()) {
      const time = session.time.updated ?? session.time.created
      const bucket = timeBucket(time, now())
      const list = buckets.get(bucket)
      if (list) list.push(session)
      else buckets.set(bucket, [session])
    }
    return BUCKET_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
      bucket,
      title: titles[bucket],
      sessions: buckets.get(bucket)!,
    }))
  })

  const menuRow = (options: {
    icon: JSX.Element | "plus" | "magnifying-glass"
    label: string
    keybind?: string
    onClick: () => void
  }) => (
    <button
      type="button"
      class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-14-regular text-text-strong hover:bg-surface-raised-base-hover"
      onClick={options.onClick}
    >
      <Show
        when={typeof options.icon === "string"}
        fallback={<span class="shrink-0 text-icon-base">{options.icon as JSX.Element}</span>}
      >
        <IconV2 name={options.icon as "plus" | "magnifying-glass"} size="small" class="shrink-0 text-icon-base" />
      </Show>
      <span class="flex-1 truncate text-start">{options.label}</span>
      <Show when={options.keybind}>
        <span class="text-12-regular text-text-weak">{options.keybind}</span>
      </Show>
    </button>
  )

  const projectRow = (project: LocalProject) => {
    const name = displayName(project)
    const open = () => isExpanded(project.worktree)
    return (
      <div class="flex flex-col gap-0.5">
        <div
          class="group/project-row flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-raised-base-hover"
          classList={{ "bg-surface-base-active": open() }}
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-start"
            onClick={() => {
              if (!open()) toggleExpanded(project.worktree)
              props.onOpenProjectDirectory(project)
            }}
          >
            <Avatar
              fallback={name}
              size="small"
              src={getProjectAvatarSource(project.id, project.icon)}
              {...(project.icon?.color ? { background: project.icon.color } : {})}
              class="size-5 shrink-0 rounded"
            />
            <span class="flex-1 truncate text-14-regular text-text-strong">{name}</span>
          </button>
          <button
            type="button"
            aria-label={name}
            class="shrink-0 rounded p-1 text-icon-base hover:bg-surface-raised-base-hover"
            onClick={() => toggleExpanded(project.worktree)}
          >
            <IconV2
              name="chevron-down"
              size="small"
              classList={{ "transition-transform duration-150 rotate-[-90deg]": !open() }}
            />
          </button>
        </div>
        <Show when={open()}>
          <div class="ms-4 flex flex-col border-s border-border-weak-base ps-1">
            <LocalWorkspace ctx={props.ctx} project={project} sortNow={now} mobile={props.mobile} />
          </div>
        </Show>
      </div>
    )
  }

  return (
    <div
      data-component="sidebar-fork"
      class="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background-base px-2 pt-3 pb-2"
    >
      <div class="flex flex-col gap-0.5">
        {menuRow({
          icon: "plus",
          label: language.t("sidebar.fork.task.new"),
          keybind: props.newTaskKeybind(),
          onClick: props.onNewSession,
        })}
        {menuRow({
          icon: "magnifying-glass",
          label: language.t("sidebar.fork.menu.search"),
          keybind: props.searchKeybind(),
          onClick: props.onOpenSearch,
        })}
      </div>

      <div class="shrink-0 px-1 pt-3 pb-2">
        <SegmentedControlV2 value={tab()} onChange={(value) => value && setTab(value as "groups" | "projects")}>
          <SegmentedControlItemV2 value="projects">{language.t("sidebar.fork.tab.projects")}</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="groups">{language.t("sidebar.fork.tab.groups")}</SegmentedControlItemV2>
        </SegmentedControlV2>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar">
        <Show
          when={tab() === "projects"}
          fallback={
            <div class="flex flex-col gap-4 py-1">
              <For each={grouped()}>
                {(group) => (
                  <div class="flex flex-col gap-0.5">
                    <div class="px-2 py-1 text-12-medium text-text-weak">{group.title}</div>
                    <For each={group.sessions}>
                      {(session) => (
                        <SessionItem
                          session={session}
                          list={group.sessions}
                          navList={props.ctx.navList}
                          slug={currentSlug()}
                          mobile={props.mobile}
                          showChild
                          sidebarExpanded={props.ctx.sidebarExpanded}
                          clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                          prefetchSession={props.ctx.prefetchSession}
                          archiveSession={props.ctx.archiveSession}
                        />
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          }
        >
          <div class="flex flex-col gap-0.5">
            <For each={props.projects()}>{(project) => projectRow(project)}</For>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-14-regular text-text-weak hover:bg-surface-raised-base-hover"
              onClick={props.onOpenProject}
            >
              <IconV2 name="folder-add-left" size="small" class="shrink-0 text-icon-base" />
              <span class="truncate">{language.t("command.project.open")}</span>
            </button>
          </div>
        </Show>
      </div>

      <div class="shrink-0 border-t border-border-weak-base pt-2">
        <div class="flex flex-col gap-0.5">
          {menuRow({
            icon: <Icon name="settings-gear" size="small" />,
            label: language.t("sidebar.fork.settings"),
            keybind: props.settingsKeybind(),
            onClick: props.onOpenSettings,
          })}
          {menuRow({
            icon: <Icon name="help" size="small" />,
            label: language.t("sidebar.help"),
            onClick: props.onOpenHelp,
          })}
        </div>
      </div>
    </div>
  )
}
