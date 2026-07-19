import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./command";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundleRoot = join(root, "src-tauri", "target.noindex");
const env = { ...process.env, CARGO_TARGET_DIR: bundleRoot, CI: "true" };
const args = ["tauri", "build"];

if (process.platform === "win32") {
  args.push("--config", "src-tauri/tauri.windows.conf.json");
}

try {
  run("bun", args, { cwd: root, env });
} finally {
  if (process.platform === "darwin") {
    const app = join(bundleRoot, "release", "bundle", "macos", "relico.app");
    const lsregister =
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    if (existsSync(app) && existsSync(lsregister)) {
      try {
        run(lsregister, ["-u", app]);
      } catch (error) {
        console.warn(`LaunchServices cleanup failed: ${String(error)}`);
      }
    }
  }
}
