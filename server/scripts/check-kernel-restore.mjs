import { readFile } from "node:fs/promises";
import { checkRestoreDeletionSafety } from "../src/storage/restore_safety.js";

const [trustedFile, candidateFile] = process.argv.slice(2);
if (!trustedFile || !candidateFile || process.argv.length !== 4) {
  throw new Error("Usage: node scripts/check-kernel-restore.mjs TRUSTED.json CANDIDATE.json");
}
const trusted = JSON.parse(await readFile(trustedFile, "utf8"));
const candidate = JSON.parse(await readFile(candidateFile, "utf8"));
const report = checkRestoreDeletionSafety(trusted, candidate);
console.log(JSON.stringify(report, null, 2));
if (!report.safe) process.exitCode = 1;
