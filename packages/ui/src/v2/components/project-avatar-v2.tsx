import { type ComponentProps, splitProps, Show, createSignal } from "solid-js"
import "./project-avatar-v2.css"

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function first(value: string) {
  if (!value) return ""
  if (!segmenter) return Array.from(value)[0] ?? ""
  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? Array.from(value)[0] ?? ""
}

export const PROJECT_AVATAR_VARIANTS = [
  "orange",
  "yellow",
  "cyan",
  "green",
  "red",
  "pink",
  "blue",
  "purple",
  "gray",
] as const

export type ProjectAvatarVariant = (typeof PROJECT_AVATAR_VARIANTS)[number]

// "outline" is a neutral, muted style (e.g. recently closed projects) and is not part of the color rotation.
export type ProjectAvatarStyle = ProjectAvatarVariant | "outline"

export interface ProjectAvatarProps extends ComponentProps<"div"> {
  fallback: string
  src?: string
  variant?: ProjectAvatarStyle
  unread?: boolean
}

export function ProjectAvatar(props: ProjectAvatarProps) {
  const [split, rest] = splitProps(props, ["fallback", "src", "variant", "unread", "class", "classList", "style"])
  // A remote src that fails to load must fall back to the letter, not an empty box.
  const [failed, setFailed] = createSignal(false)
  const showImage = () => Boolean(split.src) && !failed()
  return (
    <div
      {...rest}
      data-component="project-avatar-v2"
      data-unread={split.unread ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      style={typeof split.style === "object" ? split.style : undefined}
    >
      <div
        data-slot="project-avatar-surface"
        data-variant={split.variant ?? "gray"}
        data-has-image={showImage() ? "" : undefined}
      >
        <Show when={showImage()} fallback={first(split.fallback)}>
          <img src={split.src} draggable={false} data-slot="project-avatar-image" onError={() => setFailed(true)} />
        </Show>
      </div>
      <Show when={split.unread}>
        <span data-slot="project-avatar-unread-dot" aria-hidden="true" />
      </Show>
    </div>
  )
}
