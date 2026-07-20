import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./command";
import { cleanupOwnedListener } from "./e2e-process";

const root = fileURLToPath(new URL("..", import.meta.url));
const E2E_TARGET_DIR = "src-tauri/target.noindex";
const bundleRoot = join(root, E2E_TARGET_DIR);
const binaryName = process.platform === "win32" ? "relico.exe" : "relico";
const appBinary = join(bundleRoot, "debug", binaryName);
const leasePath = join(bundleRoot, "e2e-process.lease");
const capabilityPath = join(root, "src-tauri", "capabilities", "e2e.json");
const capabilitySource = join(root, "tools", "e2e-capability.json");
const e2ePort = 4445;

async function cleanup(): Promise<void> {
  if (!existsSync(leasePath)) return;
  await cleanupOwnedListener({
    port: e2ePort,
    expectedExecutable: appBinary,
    leasePath,
  });
}

let primaryError: unknown;
try {
  mkdirSync(bundleRoot, { recursive: true });
  if (!existsSync(leasePath)) writeFileSync(leasePath, "");
  await cleanup();

  rmSync(leasePath, { force: true });
  writeFileSync(leasePath, "");
  copyFileSync(capabilitySource, capabilityPath);

  run(
    "bun",
    [
      "tauri",
      "build",
      "--debug",
      "--no-bundle",
      "--features",
      "e2e",
      "--config",
      "src-tauri/tauri.e2e.conf.json",
    ],
    {
      cwd: root,
      env: { ...process.env, CARGO_TARGET_DIR: bundleRoot },
    },
  );
  run("node", ["node_modules/@wdio/cli/bin/wdio.js", "run", "wdio.conf.ts"], {
    cwd: root,
    env: {
      ...process.env,
      TAURI_WEBDRIVER_PORT: String(e2ePort),
      RELICO_E2E_LEASE_PATH: leasePath,
    },
  });
} catch (error) {
  primaryError = error;
} finally {
  try {
    await cleanup();
  } catch (error) {
    primaryError ??= error;
  }
  try {
    rmSync(leasePath, { force: true });
    rmSync(capabilityPath, { force: true });
  } catch (error) {
    primaryError ??= error;
  }
}

if (primaryError) throw primaryError;
