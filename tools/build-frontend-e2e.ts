import { fileURLToPath } from "node:url";
import { run } from "./command";

const root = fileURLToPath(new URL("..", import.meta.url));
run("bun", ["run", "build"], {
  cwd: root,
  env: { ...process.env, VITE_E2E: "1" },
});
