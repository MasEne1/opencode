#!/usr/bin/env bun
import { $ } from "bun"

import { mkdir, copyFile } from "node:fs/promises"
import path from "node:path"
import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`

// OPENCODE_LOCAL_CLI=1 packages the locally built CLI
// (packages/cli: bun run script/build.ts --single --baseline) instead of
// downloading the published binary, so the package carries fork changes.
if (process.env.OPENCODE_LOCAL_CLI === "1") {
  const local = path.resolve(import.meta.dirname, "../../cli/dist/cli-windows-x64-baseline/bin/lildax.exe")
  await mkdir("resources", { recursive: true })
  await copyFile(local, "resources/opencode-cli.exe")
  console.log("Copied local CLI build to resources/opencode-cli.exe")
} else if (channel === "dev") {
  await downloadCliToResources()
}
