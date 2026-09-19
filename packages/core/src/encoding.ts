/**
 * Shared file-encoding detection and round-tripping for the file tools.
 * Detection order: BOM (UTF-8 / UTF-16LE / UTF-16BE), then UTF-8 validity,
 * then the caller-supplied fallback encoding (from config `file_encoding`).
 */
export * as Encoding from "./encoding"

import { Effect } from "effect"
import { FSUtil } from "./fs-util"

const BOM_CODE = 0xfeff
const BOM = String.fromCharCode(BOM_CODE)

export interface Source {
  encoding: string
  bom: boolean
  /**
   * False when the bytes are not valid UTF-8 and no explicit fallback was
   * configured, meaning the decoded text is lossy and mutation tools must
   * refuse to write it back. detect() always sets it; hand-built sources
   * (e.g. a configured fallback for a new file) may omit it.
   */
  valid?: boolean
}

export function split(text: string) {
  if (text.charCodeAt(0) !== BOM_CODE) return { bom: false, text }
  return { bom: true, text: text.slice(1) }
}

export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  if (!bom) return stripped
  return BOM + stripped
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

function decodable(bytes: Uint8Array) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

// A valid multi byte UTF-8 sequence can be cut at the end of a truncated
// sample, so retry without up to 3 trailing bytes (the longest sequence) before giving up.
function validUtf8(bytes: Uint8Array) {
  for (let cut = 0; cut <= 3; cut++) {
    if (decodable(cut === 0 ? bytes : bytes.subarray(0, Math.max(0, bytes.length - cut)))) return true
  }
  return false
}

export function detect(bytes: Uint8Array, fallback = "utf-8"): Source {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return { encoding: "utf-8", bom: true, valid: true }
  if (startsWith(bytes, [0xff, 0xfe])) return { encoding: "utf-16le", bom: true, valid: true }
  if (startsWith(bytes, [0xfe, 0xff])) return { encoding: "utf-16be", bom: true, valid: true }
  if (validUtf8(bytes)) return { encoding: "utf-8", bom: false, valid: true }
  return { encoding: fallback, bom: false, valid: fallback !== "utf-8" }
}

// WHATWG TextEncoder only emits UTF-8 and Bun's TextDecoder cannot be relied
// on for legacy encodings, so iconv-lite is loaded on first non-native use.
type Iconv = typeof import("iconv-lite")
let iconv: Promise<Iconv> | undefined
const loadIconv = (encoding: string) => {
  if (encoding === "utf-8" || encoding === "utf-16le" || encoding === "utf-16be") return undefined
  return (iconv ??= import("iconv-lite"))
}

export const decodeText = (bytes: Uint8Array, source: Source): Effect.Effect<string> => {
  if (source.encoding === "utf-16le" || source.encoding === "utf-16be")
    // Runtimes decode both utf-16 labels fine; the TS label union only lists "utf-16".
    return Effect.succeed(new TextDecoder(source.encoding as "utf-16").decode(bytes))
  if (source.encoding === "utf-8")
    return Effect.succeed(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes))
  return Effect.promise(() =>
    loadIconv(source.encoding)!.then((iconv) => iconv.decode(Buffer.from(bytes), source.encoding)),
  )
}

export const encodeText = (text: string, source: Source): Effect.Effect<Uint8Array> => {
  const next = split(text)
  if (source.encoding === "utf-16le" || source.encoding === "utf-16be")
    return Effect.succeed(encodeUtf16(next.text, source.encoding))
  if (source.encoding === "utf-8") return Effect.succeed(encodeUtf8(next.text, source.bom))
  return Effect.promise(() => loadIconv(source.encoding)!.then((iconv) => iconv.encode(next.text, source.encoding)))
}

export const readFile = Effect.fn("Encoding.readFile")(function* (
  fs: FSUtil.Interface,
  filePath: string,
  fallback = "utf-8",
) {
  const bytes = yield* fs.readFile(filePath)
  const detected = detect(bytes, fallback)
  const decoded = split(yield* decodeText(bytes, detected))
  const bom = detected.encoding === "utf-8" ? decoded.bom : detected.bom
  return { ...detected, bom, text: decoded.text }
})

export const writeFile = Effect.fn("Encoding.writeFile")(function* (
  fs: FSUtil.Interface,
  filePath: string,
  text: string,
  source: Source,
) {
  const bytes = yield* encodeText(text, source)
  return yield* fs.writeWithDirs(filePath, bytes)
})

// Formatters rewrite files as UTF-8 without BOM, so after formatting the file
// is decoded as-is and rewritten with the encoding it was loaded with.
export const syncFile = Effect.fn("Encoding.syncFile")(function* (fs: FSUtil.Interface, filePath: string, source: Source) {
  const current = yield* readFile(fs, filePath, source.encoding)
  if (current.encoding === source.encoding && current.bom === source.bom) return current.text
  yield* writeFile(fs, filePath, current.text, source)
  return current.text
})

function encodeUtf8(text: string, bom: boolean) {
  const bytes = new TextEncoder().encode(text)
  if (!bom) return bytes
  const withBom = new Uint8Array(bytes.length + 3)
  withBom.set([0xef, 0xbb, 0xbf])
  withBom.set(bytes, 3)
  return withBom
}

function encodeUtf16(text: string, encoding: "utf-16le" | "utf-16be") {
  const little = encoding === "utf-16le"
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = little ? 0xff : 0xfe
  bytes[1] = little ? 0xfe : 0xff
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const offset = 2 + i * 2
    if (little) {
      bytes[offset] = code & 0xff
      bytes[offset + 1] = code >>> 8
    } else {
      bytes[offset] = code >>> 8
      bytes[offset + 1] = code & 0xff
    }
  }
  return bytes
}
