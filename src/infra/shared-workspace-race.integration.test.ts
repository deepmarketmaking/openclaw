import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function agentLikeFlow(filePath: string, marker: string, delayMs: number) {
  const snapshot = await fs.readFile(filePath, "utf8");
  await sleep(delayMs);
  const next = `${snapshot}${marker}\n`;
  await fs.writeFile(filePath, next, "utf8");
}

describe("shared workspace race (integration)", () => {
  it("preserves both concurrent agent updates", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-race-test-"));
    const file = path.join(dir, "shared.txt");
    await fs.writeFile(file, "seed\n", "utf8");

    await Promise.all([agentLikeFlow(file, "agent-A", 25), agentLikeFlow(file, "agent-B", 5)]);

    const finalText = await fs.readFile(file, "utf8");
    await fs.rm(dir, { recursive: true, force: true });

    expect(finalText).toContain("agent-A");
    expect(finalText).toContain("agent-B");
  });
});
