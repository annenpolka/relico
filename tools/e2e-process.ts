import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";

export type CleanupOptions = {
  port: number;
  expectedExecutable: string;
  leasePath: string;
  graceMs?: number;
};

export type CleanupResult = {
  terminatedPids: number[];
  forcedPids: number[];
};

type OwnedProcessIdentity = {
  pid: number;
  executable: string;
  leasePath: string;
  leaseIdentity: string;
};

const LSOF_CANDIDATES = ["/usr/sbin/lsof", "/usr/bin/lsof", "lsof"];

function lsofPath(): string {
  return LSOF_CANDIDATES.find((candidate) =>
    candidate.includes("/") ? existsSync(candidate) : true,
  )!;
}

function runLsof(args: string[]): string {
  const result = spawnSync(lsofPath(), args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 0) return result.stdout;
  // lsofは該当process/fileがない場合もstatus=1を返す。
  if (result.status === 1 && !result.stderr.trim()) return "";
  throw new Error(`lsof failed (${result.status}): ${result.stderr.trim()}`);
}

function canonical(path: string): string {
  return realpathSync(path.replace(/ \(deleted\)$/, ""));
}

export function listeningPids(port: number): number[] {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid TCP port: ${port}`);
  }
  const output = runLsof(["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]);
  return Array.from(
    new Set(
      output
        .split("\n")
        .filter((line) => /^p\d+$/.test(line))
        .map((line) => Number(line.slice(1))),
    ),
  ).sort((left, right) => left - right);
}

function leaseFileIdentity(path: string): string {
  const stats = statSync(path, { bigint: true });
  return `${stats.dev}:${stats.ino}`;
}

export function leaseHolderPids(path: string): number[] {
  if (!existsSync(path)) return [];
  const leasePath = canonical(path);
  const output = runLsof(["-nP", "-Fp", "--", leasePath]);
  return Array.from(
    new Set(
      output
        .split("\n")
        .filter((line) => /^p\d+$/.test(line))
        .map((line) => Number(line.slice(1))),
    ),
  ).sort((left, right) => left - right);
}

export function executableForPid(pid: number): string | null {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const output = runLsof(["-nP", "-a", "-p", String(pid), "-d", "txt", "-Fn"]);
  const path = output
    .split("\n")
    .find((line) => line.startsWith("n") && line.length > 1)
    ?.slice(1);
  if (!path) return null;
  try {
    return canonical(path);
  } catch {
    return null;
  }
}

export function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function assertExpectedExecutable(pid: number, expectedExecutable: string): void {
  const actual = executableForPid(pid);
  if (actual !== expectedExecutable) {
    throw new Error(
      `refusing to terminate foreign listener pid=${pid}: expected=${expectedExecutable}, actual=${actual ?? "unknown"}`,
    );
  }
}

function captureOwnedIdentity(
  pid: number,
  expectedExecutable: string,
  leasePath: string,
): OwnedProcessIdentity {
  assertExpectedExecutable(pid, expectedExecutable);
  if (!leaseHolderPids(leasePath).includes(pid)) {
    throw new Error(`process no longer holds E2E lease pid=${pid}`);
  }
  return {
    pid,
    executable: expectedExecutable,
    leasePath,
    leaseIdentity: leaseFileIdentity(leasePath),
  };
}

function matchesOwnedIdentity(identity: OwnedProcessIdentity): boolean {
  if (!processExists(identity.pid)) return false;
  try {
    return (
      leaseFileIdentity(identity.leasePath) === identity.leaseIdentity &&
      executableForPid(identity.pid) === identity.executable &&
      leaseHolderPids(identity.leasePath).includes(identity.pid)
    );
  } catch {
    return false;
  }
}

function assertOwnedIdentity(identity: OwnedProcessIdentity): void {
  if (!matchesOwnedIdentity(identity)) {
    throw new Error(
      `E2E process ownership identity changed; refusing signal pid=${identity.pid}`,
    );
  }
}

function signal(pid: number, value: NodeJS.Signals): void {
  try {
    process.kill(pid, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForOwnedExit(
  identities: OwnedProcessIdentity[],
  timeoutMs: number,
): Promise<OwnedProcessIdentity[]> {
  const deadline = Date.now() + timeoutMs;
  let alive = identities;
  while (alive.length > 0 && Date.now() < deadline) {
    await delay(25);
    const next: OwnedProcessIdentity[] = [];
    for (const identity of alive) {
      if (!processExists(identity.pid)) continue;
      assertOwnedIdentity(identity);
      next.push(identity);
    }
    alive = next;
  }
  return alive;
}

/**
 * E2E専用lease inodeを保持するprocessを、canonical executableが完全一致する場合だけ終了する。
 * port bind前・listener終了後も回収する一方、leaseなしのlistenerや同名processは対象にしない。
 */
export async function cleanupOwnedListener(options: CleanupOptions): Promise<CleanupResult> {
  const listenerPids = listeningPids(options.port);
  const holderPids = leaseHolderPids(options.leasePath);
  if (listenerPids.length === 0 && holderPids.length === 0) {
    return { terminatedPids: [], forcedPids: [] };
  }
  const expectedExecutable = canonical(options.expectedExecutable);
  const leasePath = canonical(options.leasePath);
  const holderSet = new Set(holderPids);

  // 同portのforeign listenerを巻き込まない。対象を1つでも検証できなければsignal前に拒否する。
  for (const pid of listenerPids) {
    const actual = executableForPid(pid);
    if (actual !== expectedExecutable || !holderSet.has(pid)) {
      throw new Error(
        `refusing to terminate foreign listener pid=${pid}: expected=${expectedExecutable}, actual=${actual ?? "unknown"}, lease=${holderSet.has(pid)}`,
      );
    }
  }
  const identities = holderPids.map((pid) =>
    captureOwnedIdentity(pid, expectedExecutable, leasePath),
  );

  for (const identity of identities) assertOwnedIdentity(identity);
  for (const identity of identities) {
    // 検査とsignalの間隔を最小化する。identityが変わればsignalを送らず失敗する。
    assertOwnedIdentity(identity);
    signal(identity.pid, "SIGTERM");
  }
  const survivors = await waitForOwnedExit(identities, options.graceMs ?? 5_000);
  const forcedPids: number[] = [];
  for (const identity of survivors) {
    // TERM待機中のPID再利用・lease差し替え・別processへの入れ替わりをKILL前に再照合する。
    assertOwnedIdentity(identity);
    signal(identity.pid, "SIGKILL");
    forcedPids.push(identity.pid);
  }

  const remaining = await waitForOwnedExit(survivors, 1_000);
  if (remaining.length > 0) {
    throw new Error(
      `E2E lease process did not exit: ${remaining.map(({ pid }) => pid).join(", ")}`,
    );
  }
  const remainingHolders = leaseHolderPids(leasePath);
  const remainingListeners = listeningPids(options.port);
  if (remainingHolders.length > 0 || remainingListeners.length > 0) {
    throw new Error(
      `E2E cleanup left resources: holders=${remainingHolders.join(",") || "none"}, listeners=${remainingListeners.join(",") || "none"}`,
    );
  }
  return {
    terminatedPids: identities.map(({ pid }) => pid),
    forcedPids,
  };
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`missing ${name}`);
  return args[index + 1];
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "cleanup") {
    throw new Error(
      "usage: bun tools/e2e-process.ts cleanup --port PORT --executable PATH --lease PATH",
    );
  }
  const result = await cleanupOwnedListener({
    port: Number(option(args, "--port")),
    expectedExecutable: option(args, "--executable"),
    leasePath: option(args, "--lease"),
  });
  if (result.terminatedPids.length > 0) {
    const forced = result.forcedPids.length > 0 ? `; forced=${result.forcedPids.join(",")}` : "";
    console.log(`E2E cleanup: terminated=${result.terminatedPids.join(",")}${forced}`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`E2E cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
