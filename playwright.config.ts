import { defineConfig } from "@playwright/test";

// renderer統合テスト(tests/renderer)専用の設定。
// macOSはWKWebViewに近いWebKit、WindowsはWebView2に近いChromiumでrendererを検査する。
const browserName: "chromium" | "webkit" =
  process.platform === "win32" ? "chromium" : "webkit";

export default defineConfig({
  testDir: "tests/renderer",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1421",
  },
  projects: [{ name: browserName, use: { browserName } }],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --port 1421 --strictPort",
    url: "http://localhost:1421",
    reuseExistingServer: true,
    stdout: "ignore",
  },
});
