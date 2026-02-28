import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function agentLikeFlow(filePath, marker, delayMs) {
  const snapshot = await fs.readFile(filePath, "utf8");
  await sleep(delayMs);
  const next = `${snapshot}${marker}\n`;
  await fs.writeFile(filePath, next, "utf8");
}

async function runOnce(iteration) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-race-"));
  const file = path.join(dir, "shared.txt");
  await fs.writeFile(file, "seed\n", "utf8");

  // Two concurrent agent-like read-modify-write flows on same shared file.
  const p1 = agentLikeFlow(file, `agent-A-${iteration}`, 25);
  const p2 = agentLikeFlow(file, `agent-B-${iteration}`, 5);
  await Promise.all([p1, p2]);

  const finalText = await fs.readFile(file, "utf8");
  const hasA = finalText.includes(`agent-A-${iteration}`);
  const hasB = finalText.includes(`agent-B-${iteration}`);
  await fs.rm(dir, { recursive: true, force: true });
  return { hasA, hasB, finalText };
}

let lost = 0;
const trials = 20;
for (let i = 0; i < trials; i += 1) {
  const r = await runOnce(i);
  if (!(r.hasA && r.hasB)) {
    lost += 1;
    console.log(`LOSS@${i}:`);
    console.log(r.finalText.trim());
  }
}

console.log(JSON.stringify({ trials, lost, lossRate: lost / trials }, null, 2));
if (lost === 0) {
  process.exitCode = 1;
}
