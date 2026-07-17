import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// WDIO Tauri E2E(tests/e2e)専用の設定。
// just e2e が e2e featureビルド(WebDriverサーバ内蔵・専用identity)を作ってから実行する。
// DOM結線の網羅は tests/renderer(Playwright)が担い、ここは実IPCの証明に絞る(docs/E2E.md)。

const appBinary = join(process.cwd(), "src-tauri/target.noindex/debug/relico");
// 専用identityの設定ディレクトリ。テストの決定性のため毎回まっさらにする
const e2eConfigDir = join(homedir(), "Library/Application Support/com.annenpolka.relico.e2e");

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
