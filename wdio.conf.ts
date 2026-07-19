import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// WDIO Tauri E2E(tests/e2e)専用の設定。
// just e2e が e2e featureビルド(WebDriverサーバ内蔵・専用identity)を作ってから実行する。
// DOM結線の網羅は tests/renderer(Playwright)が担い、ここは実IPCの証明に絞る(docs/E2E.md)。

const binaryName = process.platform === "win32" ? "relico.exe" : "relico";
const appBinary = join(process.cwd(), "src-tauri/target.noindex/debug", binaryName);
const e2ePort = Number(process.env.TAURI_WEBDRIVER_PORT);
if (!Number.isInteger(e2ePort) || e2ePort < 1 || e2ePort > 65_535) {
  throw new Error("TAURI_WEBDRIVER_PORT must be set by just e2e");
}
const e2eLeasePath = process.env.RELICO_E2E_LEASE_PATH;
if (!e2eLeasePath) throw new Error("RELICO_E2E_LEASE_PATH must be set by just e2e");
// 専用identityの設定ディレクトリ。テストの決定性のため毎回まっさらにする
const e2eConfigDir =
  process.platform === "win32"
    ? join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "com.annenpolka.relico.e2e",
      )
    : process.platform === "darwin"
      ? join(homedir(), "Library/Application Support/com.annenpolka.relico.e2e")
      : join(
          process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
          "com.annenpolka.relico.e2e",
        );

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./tests/e2e/**/*.e2e.ts"],
  maxInstances: 1,
  logLevel: "warn",
  outputDir: "wdio-logs",
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120000 },
  reporters: ["spec"],

  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: appBinary,
        driverProvider: "embedded",
        // 数値literalはjustfileだけに置き、ここでは同じenv値を検証して使う。
        embeddedPort: e2ePort,
        env: { RELICO_E2E_LEASE_PATH: e2eLeasePath },
      },
    ],
  ],

  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinary,
      },
    },
  ],

  onPrepare: () => {
    rmSync(e2eConfigDir, { recursive: true, force: true });
  },
};
