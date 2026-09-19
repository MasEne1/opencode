import { $ } from "bun"
import { copyFile, mkdir } from "fs/promises"
import path from "path"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`

// Local development: set OPENCODE_LOCAL_CLI=1 to use the locally built CLI
// (packages/cli: bun run script/build.ts --single) instead of downloading the
// published binary, so desktop picks up local core/tool changes.
if (process.env.OPENCODE_LOCAL_CLI === "1") {
  const local = path.resolve(import.meta.dirname, "../../cli/dist/cli-windows-x64/bin/lildax.exe")
  await mkdir("resources", { recursive: true })
  await copyFile(local, "resources/opencode-cli.exe")
  console.log("Copied local CLI build to resources/opencode-cli.exe")
} else {
  await downloadCliToResources()
}
