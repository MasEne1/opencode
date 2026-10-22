/**
 * Shared file-encoding detection and round-tripping for the file tools.
 * Detection: BOM (UTF-8 / UTF-16LE / UTF-16BE), then UTF-8 validity, then a
 * lossless decode/encode round-trip among common legacy encodings. A detected
 * legacy encoding always reproduces the original bytes exactly, so mutations
 * write back byte-safe even when a CJK variant is misidentified.
 */
export * as Encoding from "./encoding.js"

import { Effect } from "effect"
import { Bom } from "@opencode/util/bom"

export interface Source {
  readonly encoding: string
  readonly bom: boolean
  /**
   * False when the bytes are neither BOM-marked, valid UTF-8, nor losslessly
   * round-trippable in any known encoding, meaning the decoded text is lossy
   * and mutation tools must refuse to write it back. detect() always sets it;
   * hand-built sources (e.g. defaults for a new file) may omit it.
   */
  readonly valid?: boolean
}

export const split = Bom.split
export const join = Bom.join

const BOM_PREFIXES = [
  { encoding: "utf-8", bytes: [0xef, 0xbb, 0xbf] },
  { encoding: "utf-16le", bytes: [0xff, 0xfe] },
  { encoding: "utf-16be", bytes: [0xfe, 0xff] },
] as const

// Tried in order after BOM and UTF-8 checks. gb18030 first: it round-trips
// nearly every CJK byte stream, including its GBK subset, which makes it the
// safest guess; a misdetected CJK variant still round-trips byte-exactly.
const CANDIDATES = ["gb18030", "big5", "shift_jis", "euc-kr", "windows-1252"] as const

// More decoded control characters (excluding tab/newline) than this share
// means the bytes are likely binary rather than legacy-encoded text.
const MAX_CONTROL_RATIO = 0.02

function startsWith(bytes: Uint8Array, prefix: readonly number[]) {
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

function plausible(text: string) {
  if (text.length === 0) return true
  let control = 0
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (code === 9 || code === 10 || code === 13) continue
    if (code < 32 || code === 127) control++
  }
  return control / text.length <= MAX_CONTROL_RATIO
}

type Iconv = typeof import("iconv-lite")
let iconv: Promise<Iconv> | undefined
// WHATWG TextEncoder only emits UTF-8 and the runtime TextDecoder cannot be
// relied on for legacy encodings, so iconv-lite is loaded on first non-native use.
const loadIconv = () => (iconv ??= import("iconv-lite"))

function roundTrips(mod: Iconv, bytes: Uint8Array, encoding: string) {
  const buffer = Buffer.from(bytes)
  // A truncated multi-byte sequence at the sample end can decode losslessly
  // after dropping up to three trailing bytes, so retry before rejecting.
  for (let cut = 0; cut <= 3; cut++) {
    const sample = cut === 0 ? buffer : buffer.subarray(0, Math.max(0, bytes.length - cut))
    const text = mod.decode(sample, encoding)
    if (text.includes("\uFFFD")) continue
    if (!plausible(text)) return false
    if (Buffer.from(mod.encode(text, encoding)).equals(sample)) return true
  }
  return false
}

export const detect = (bytes: Uint8Array): Effect.Effect<Source> =>
  Effect.promise(async () => {
    for (const prefix of BOM_PREFIXES)
      if (startsWith(bytes, prefix.bytes)) return { encoding: prefix.encoding, bom: true, valid: true }
    if (validUtf8(bytes)) return { encoding: "utf-8", bom: false, valid: true }
    const mod = await loadIconv()
    for (const encoding of CANDIDATES)
      if (roundTrips(mod, bytes, encoding)) return { encoding, bom: false, valid: true }
    return { encoding: "utf-8", bom: false, valid: false }
  })

export const decodeText = (bytes: Uint8Array, source: Source): Effect.Effect<string> => {
  if (source.encoding === "utf-16le" || source.encoding === "utf-16be")
    // Runtimes decode both utf-16 labels fine; the TS label union only lists "utf-16".
    return Effect.succeed(new TextDecoder(source.encoding as "utf-16").decode(bytes))
  if (source.encoding === "utf-8") return Effect.succeed(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes))
  return Effect.promise(() => loadIconv().then((mod) => mod.decode(Buffer.from(bytes), source.encoding)))
}

export const encodeText = (text: string, source: Source): Effect.Effect<Uint8Array> => {
  const next = split(text)
  if (source.encoding === "utf-16le" || source.encoding === "utf-16be")
    return Effect.succeed(encodeUtf16(next.text, source.encoding))
  if (source.encoding === "utf-8") return Effect.succeed(encodeUtf8(next.text, source.bom))
  return Effect.promise(() => loadIconv().then((mod) => mod.encode(next.text, source.encoding)))
}

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
