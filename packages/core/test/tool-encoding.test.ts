import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { decode, encode } from "iconv-lite"
import { Effect, Layer, Result } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Encoding } from "@opencode/core/encoding"
import { Environment } from "@opencode/core/environment/index"
import { Formatter } from "@opencode/core/formatter"
import { FileMutation } from "@opencode/core/file-mutation"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { transformEnvironmentFiles } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin } from "./lib/tool"

const sessionID = Session.ID.make("ses_encoding_tool_test")

const toolDeps = [
  Tool.node,
  FileAccess.node,
  FileMutation.node,
  Environment.node,
  Formatter.node,
  Location.node,
  Permission.node,
] as const

const editNode = makeLocationNode({
  name: "test/encoding-edit",
  layer: Layer.effectDiscard(registerToolPlugin(EditTool.Plugin)),
  deps: toolDeps,
})
const writeNode = makeLocationNode({
  name: "test/encoding-write",
  layer: Layer.effectDiscard(registerToolPlugin(WriteTool.Plugin)),
  deps: toolDeps,
})
const patchNode = makeLocationNode({
  name: "test/encoding-patch",
  layer: Layer.effectDiscard(registerToolPlugin(PatchTool.Plugin)),
  deps: toolDeps,
})

const withTools = <A, E, R>(
  directory: string,
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          Tool.node,
          FileAccess.node,
          FileMutation.node,
          Environment.node,
          editNode,
          writeNode,
          patchNode,
        ]),
        [
          Environment.node.replace(transformEnvironmentFiles(() => ({}))),
          Location.node.replace(activeLocation),
          Formatter.node.replace(Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })),
          Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
        ],
      ),
    ),
  )
}

const call = (name: string, input: unknown, id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})

const it = testEffect(Layer.empty)

const errorMessage = (settled: { readonly status: string; readonly error?: unknown }) =>
  settled.status === "error" ? JSON.stringify(settled.error) : ""

describe("Encoding", () => {
  it.live("detects BOM-marked and UTF-8 files", () =>
    Effect.gen(function* () {
      expect(yield* Encoding.detect(new TextEncoder().encode("hello world\n"))).toEqual({
        encoding: "utf-8",
        bom: false,
        valid: true,
      })
      expect(yield* Encoding.detect(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toEqual({
        encoding: "utf-8",
        bom: true,
        valid: true,
      })
      const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好\n", "utf16le")])
      const source = yield* Encoding.detect(utf16)
      expect(source).toEqual({ encoding: "utf-16le", bom: true, valid: true })
      expect(yield* Encoding.decodeText(utf16, source)).toBe("你好\n")
    }),
  )

  it.live("detects GBK bytes as gb18030 and round-trips them", () =>
    Effect.gen(function* () {
      const original = "function greet() {\n  你好世界\n}\n"
      const bytes = encode(original, "gbk")
      const source = yield* Encoding.detect(bytes)
      expect(source.encoding).toBe("gb18030")
      expect(source.valid).toBe(true)
      expect(yield* Encoding.decodeText(bytes, source)).toBe(original)
      expect(Buffer.from(yield* Encoding.encodeText(original, source)).equals(Buffer.from(bytes))).toBe(true)
    }),
  )

  it.live("marks undecodable bytes as invalid", () =>
    Effect.gen(function* () {
      const junk = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0x81 : 0xff))
      const source = yield* Encoding.detect(junk)
      expect(source.encoding).toBe("utf-8")
      expect(source.valid).toBe(false)
    }),
  )

  it.live("keeps a UTF-8 BOM through decode and encode", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hi\n")])
      const source = yield* Encoding.detect(bytes)
      const text = yield* Encoding.decodeText(bytes, source)
      expect(text.charCodeAt(0)).toBe(0xfeff)
      expect(Buffer.from(yield* Encoding.encodeText(text, source)).equals(Buffer.from(bytes))).toBe(true)
    }),
  )
})

describe("tool encoding", () => {
  it.live("edits a GBK file in place without configuration", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "gbk.txt")
      const original = encode("function greet() {\n  你好世界\n}\n", "gbk")
      return Effect.promise(() => fs.writeFile(target, original)).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call("edit", { path: "gbk.txt", oldString: "你好世界", newString: "再见世界" }, "call-encoding-edit"),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("completed")
            const bytes = yield* Effect.promise(() => fs.readFile(target))
            expect(decode(bytes, "gbk")).toBe("function greet() {\n  再见世界\n}\n")
          }),
        ),
      )
    }),
  )

  it.live("refuses to edit a file whose encoding cannot be identified", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "junk.txt")
      const junk = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0x81 : 0xff))
      return Effect.promise(() => fs.writeFile(target, junk)).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call("edit", { path: "junk.txt", oldString: "a", newString: "b" }, "call-encoding-junk"),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("error")
            expect(errorMessage(settled)).toContain("encoding")
            expect(Buffer.from(yield* Effect.promise(() => fs.readFile(target)))).toEqual(Buffer.from(junk))
          }),
        ),
      )
    }),
  )

  it.live("edits a utf-16le file with BOM in place", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "utf16le.txt")
      const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好世界\n", "utf16le")])
      return Effect.promise(() => fs.writeFile(target, bytes)).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call("edit", { path: "utf16le.txt", oldString: "你好世界", newString: "再见世界" }, "call-encoding-u16"),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("completed")
            const written = yield* Effect.promise(() => fs.readFile(target))
            expect([...written.slice(0, 2)]).toEqual([0xff, 0xfe])
            expect(Buffer.from(written.slice(2)).toString("utf16le")).toBe("再见世界\n")
          }),
        ),
      )
    }),
  )

  it.live("writes an existing GBK file back as GBK and creates new files as UTF-8", () =>
    withTempDir((tmp) => {
      const existing = path.join(tmp.path, "existing.txt")
      const created = path.join(tmp.path, "created.txt")
      return Effect.promise(() => fs.writeFile(existing, encode("旧内容\n", "gbk"))).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              expect(
                (
                  yield* executeTool(
                    registry,
                    call("write", { path: "existing.txt", content: "新内容\n" }, "call-encoding-write"),
                  )
                ).status,
              ).toBe("completed")
              expect(decode(yield* Effect.promise(() => fs.readFile(existing)), "gbk")).toBe("新内容\n")
              expect(
                (
                  yield* executeTool(
                    registry,
                    call("write", { path: "created.txt", content: "created\n" }, "call-encoding-create"),
                  )
                ).status,
              ).toBe("completed")
              expect(yield* Effect.promise(() => fs.readFile(created, "utf8"))).toBe("created\n")
            }),
          ),
        ),
      )
    }),
  )

  it.live("patches a GBK file in place", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "gbk.txt")
      return Effect.promise(() => fs.writeFile(target, encode("第一行\n第二行\n", "gbk"))).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call(
                "patch",
                {
                  patchText: "*** Begin Patch\n*** Update File: gbk.txt\n@@\n-第二行\n+第二行改\n*** End Patch",
                },
                "call-encoding-patch",
              ),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("completed")
            expect(decode(yield* Effect.promise(() => fs.readFile(target)), "gbk")).toBe("第一行\n第二行改\n")
          }),
        ),
      )
    }),
  )

  it.live("decodes a GBK file through the filesystem reader", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "gbk.txt")
      return Effect.promise(() => fs.writeFile(target, encode("第一行\n第二行\n第三行\n", "gbk"))).pipe(
        Effect.andThen(
          withTools(tmp.path, () =>
            Effect.gen(function* () {
              const environment = yield* Environment.Service
              const absolute = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(target)))
              const paged = yield* ReadToolFileSystem.read(environment.files, absolute, "gbk.txt", {
                offset: 2,
                limit: 1,
              })
              expect(paged.type).toBe("text-page")
              if (paged.type !== "text-page") return
              expect(paged.content).toBe("第二行")
              expect(paged.next).toBe(3)
              const whole = yield* ReadToolFileSystem.read(environment.files, absolute, "gbk.txt")
              expect(whole.type).toBe("text-page")
              if (whole.type !== "text-page") return
              expect(whole.content).toContain("第一行")
              expect(whole.content).toContain("第三行")
            }),
          ),
        ),
      )
    }),
  )

  it.live("reads files whose encoding cannot be identified lossily as UTF-8", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "junk.txt")
      return Effect.promise(() => fs.writeFile(target, Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0x81 : 0xff)))).pipe(
        Effect.andThen(
          withTools(tmp.path, () =>
            Effect.gen(function* () {
              const environment = yield* Environment.Service
              const absolute = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(target)))
              const result = yield* Effect.result(
                ReadToolFileSystem.read(environment.files, absolute, "junk.txt"),
              )
              expect(Result.isSuccess(result)).toBe(true)
            }),
          ),
        ),
      )
    }),
  )
})
