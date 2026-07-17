import { defineConfig } from "@playwright/test";

// renderer統合テスト(tests/renderer)専用の設定。
// WKWebViewに最も近いWebKitエンジンで、Tauri IPCをmockしたフロントエンドを検査する。
export default defineConfig({
  testDir: "tests/renderer",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1421",
  },
  projects: [{ name: "webkit", use: { browserName: "webkit" } }],
  webServer: {
    command: "bunx vite --port 1421 --strictPort",
    url: "http://localhost:1421",
    reuseExistingServer: true,
    stdout: "ignore",
  },
});
