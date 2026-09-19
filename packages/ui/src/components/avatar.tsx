import { type ComponentProps, splitProps, Show, createSignal } from "solid-js"

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function first(value: string) {
  if (!value) return ""
  if (!segmenter) return Array.from(value)[0] ?? ""
  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? Array.from(value)[0] ?? ""
}

export interface AvatarProps extends ComponentProps<"div"> {
  fallback: string
  src?: string
  background?: string
  foreground?: string
  size?: "small" | "normal" | "large"
}

export function Avatar(props: AvatarProps) {
  const [split, rest] = splitProps(props, [
    "fallback",
    "src",
    "background",
    "foreground",
    "size",
    "class",
    "classList",
    "style",
  ])
  const src = split.src // did this so i can zero it out to test fallback
  // A remote src that fails to load must fall back to the letter, not an empty box.
  const [failed, setFailed] = createSignal(false)
  const showImage = () => Boolean(src) && !failed()
  return (
    <div
      {...rest}
      data-component="avatar"
      data-size={split.size || "normal"}
      data-has-image={showImage() ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      style={{
        ...(typeof split.style === "object" ? split.style : {}),
        ...(!showImage() && split.background ? { "--avatar-bg": split.background } : {}),
        ...(!showImage() && split.foreground ? { "--avatar-fg": split.foreground } : {}),
      }}
    >
      <Show when={showImage()} fallback={first(split.fallback)}>
        <img src={src} draggable={false} data-slot="avatar-image" onError={() => setFailed(true)} />
      </Show>
    </div>
  )
}
