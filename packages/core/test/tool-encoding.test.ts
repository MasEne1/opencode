import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { decode, encode } from "iconv-lite"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { EditTool } from "@opencode-ai/core/tool/edit"
import { WriteTool } from "@opencode-ai/core/tool/write"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_encoding_tool_test")

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const configWith = (values: { file_encoding?: string }) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({ type: "document", info: Config.Info.make({ ...values }) }),
        ]),
    }),
  )

const withTool = <A, E, R>(
  directory: string,
  values: { file_encoding?: string },
  body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>,
) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          ToolRegistry.node,
          ToolRegistry.toolsNode,
          LocationMutation.node,
          FileMutation.node,
          FSUtil.node,
          EditTool.node,
          WriteTool.node,
        ]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [Config.node, configWith(values)],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )
}

const editCall = (input: typeof EditTool.Input.Type, id = "call-encoding-edit") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "edit", input },
})

const writeCall = (input: typeof WriteTool.Input.Type, id = "call-encoding-write") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "write", input },
})

const it = testEffect(Layer.empty)

describe("tool encoding", () => {
  it.live("edits a GBK file in place when file_encoding is configured", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const target = path.join(tmp.path, "gbk.txt")
        return Effect.promise(() => fs.writeFile(target, encode("function greet() {\n  你好世界\n}\n", "gbk"))).pipe(
          Effect.andThen(
            withTool(tmp.path, { file_encoding: "gbk" }, (registry) =>
              executeTool(registry, editCall({ path: "gbk.txt", oldString: "你好世界", newString: "再见世界" })),
            ),
          ),
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result.type).toBe("text")
              const bytes = yield* Effect.promise(() => fs.readFile(target))
              expect(decode(bytes, "gbk")).toBe("function greet() {\n  再见世界\n}\n")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("refuses to edit a non-UTF-8 file when no fallback is configured", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const target = path.join(tmp.path, "gbk.txt")
        const original = encode("你好世界\n", "gbk")
        return Effect.promise(() => fs.writeFile(target, original)).pipe(
          Effect.andThen(
            withTool(tmp.path, {}, (registry) =>
              executeTool(registry, editCall({ path: "gbk.txt", oldString: "你好世界", newString: "再见世界" })),
            ),
          ),
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result.type).toBe("error")
              expect("value" in result && result.value).toContain("file_encoding")
              const bytes = yield* Effect.promise(() => fs.readFile(target))
              expect(Buffer.compare(Buffer.from(bytes), original)).toBe(0)
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("edits a utf-16le file with BOM in place without configuration", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const target = path.join(tmp.path, "utf16le.txt")
        const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好世界\n", "utf16le")])
        return Effect.promise(() => fs.writeFile(target, bytes)).pipe(
          Effect.andThen(
            withTool(tmp.path, {}, (registry) =>
              executeTool(registry, editCall({ path: "utf16le.txt", oldString: "你好世界", newString: "再见世界" })),
            ),
          ),
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result.type).toBe("text")
              const written = yield* Effect.promise(() => fs.readFile(target))
              expect([...written.slice(0, 2)]).toEqual([0xff, 0xfe])
              expect(Buffer.from(written.slice(2)).toString("utf16le")).toBe("再见世界\n")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("creates new files in the configured fallback encoding through write", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const target = path.join(tmp.path, "new-gbk.txt")
        return withTool(tmp.path, { file_encoding: "gbk" }, (registry) =>
          executeTool(registry, writeCall({ path: "new-gbk.txt", content: "中文内容\n" })),
        ).pipe(
          Effect.andThen((result) =>
            Effect.gen(function* () {
              expect(result.type).toBe("text")
              const bytes = yield* Effect.promise(() => fs.readFile(target))
              expect(decode(bytes, "gbk")).toBe("中文内容\n")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("decodes a GBK file through the filesystem reader with the configured fallback", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const target = path.join(tmp.path, "gbk.txt")
        return Effect.promise(() => fs.writeFile(target, encode("第一行\n第二行\n", "gbk"))).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              const fs = yield* FSUtil.Service
              const absolute = AbsolutePath.make(yield* fs.realPath(target))
              const page = yield* ReadToolFileSystem.read(fs, absolute, "gbk.txt", { offset: 1, limit: 10 }, "gbk")
              expect("content" in page && page.content).toContain("第一行")
              expect("content" in page && page.content).toContain("第二行")
            }).pipe(Effect.provide(LayerNode.compile(FSUtil.node))),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

test("encoding test suite loads", () => {
  expect(true).toBe(true)
})
