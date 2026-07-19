import { fileURLToPath } from "node:url";
import { run } from "./command";

const root = fileURLToPath(new URL("..", import.meta.url));
const generated = [
  "docs/SPEC.md",
  "src-tauri/tests/oracles_generated.rs",
  "tests/unit/oracles_generated.test.ts",
  "tests/renderer/oracles_generated.spec.ts",
  "tests/e2e/oracles_generated.e2e.ts",
];

async function sha256(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

async function hashes(): Promise<string[]> {
  return Promise.all(generated.map((path) => sha256(`${root}/${path}`)));
}

const before = await hashes();
run("bun", ["tools/spec-gen.ts"], { cwd: root });
const after = await hashes();
if (before.some((digest, index) => digest !== after[index])) {
  throw new Error(
    "NG: 生成物が specs/ より古かった。just spec-gen の結果を確認してコミットすること",
  );
}

run("bun", ["test", "tests/unit"], { cwd: root });
run("cargo", ["test"], { cwd: `${root}/src-tauri` });
