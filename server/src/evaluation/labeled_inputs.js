import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_MAX_IMAGE_BYTES } from "../constants.js";
import { validateLabelManifest } from "./labeled_analysis.js";

const imageTypes = [
  [".png", "image/png", (bytes) => bytes.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  [".jpg", "image/jpeg", (bytes) => bytes.length >= 3 && bytes[0] === 0xff &&
    bytes[1] === 0xd8 && bytes[2] === 0xff],
  [".jpeg", "image/jpeg", (bytes) => bytes.length >= 3 && bytes[0] === 0xff &&
    bytes[1] === 0xd8 && bytes[2] === 0xff],
  [".webp", "image/webp", (bytes) => bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"],
];

async function inspectImage(directory, entry) {
  const matches = [];
  for (const [extension, mimeType, hasSignature] of imageTypes) {
    const path = join(directory, `${entry.id}${extension}`);
    let file;
    try { file = await lstat(path); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      return { reason: "unreadable_image" };
    }
    matches.push({ path, file, mimeType, hasSignature });
  }
  if (matches.length === 0) return { reason: "missing_image" };
  if (matches.length > 1) return { reason: "ambiguous_image" };
  const { path, file, mimeType, hasSignature } = matches[0];
  if (file.isSymbolicLink() || !file.isFile()) return { reason: "invalid_image_file" };
  if (file.size === 0) return { reason: "empty_image" };
  if (file.size > DEFAULT_MAX_IMAGE_BYTES) return { reason: "image_too_large" };
  let bytes;
  try { bytes = await readFile(path); }
  catch { return { reason: "unreadable_image" }; }
  if (bytes.length === 0) return { reason: "empty_image" };
  if (bytes.length > DEFAULT_MAX_IMAGE_BYTES) return { reason: "image_too_large" };
  if (!hasSignature(bytes)) return { reason: "invalid_image_type" };
  if (createHash("sha256").update(bytes).digest("hex") !== entry.inputSha256) {
    return { reason: "input_hash_mismatch" };
  }
  return { reason: null, bytes, mimeType };
}

async function assertImageDirectory(imageDirectory) {
  let directory;
  try { directory = await lstat(imageDirectory); }
  catch { throw new Error("INVALID_EVALUATION_IMAGE_DIRECTORY"); }
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new Error("INVALID_EVALUATION_IMAGE_DIRECTORY");
  }
}

export async function loadVerifiedLabeledImage(imageDirectory, entry) {
  await assertImageDirectory(imageDirectory);
  const image = await inspectImage(imageDirectory, entry);
  if (image.reason) throw new Error("INVALID_EVALUATION_IMAGE");
  return { bytes: image.bytes, mimeType: image.mimeType };
}

export async function checkLabeledInputs(manifest, imageDirectory) {
  validateLabelManifest(manifest);
  await assertImageDirectory(imageDirectory);
  const failures = [];
  const domains = {};
  for (const entry of manifest.entries) {
    const { reason } = await inspectImage(imageDirectory, entry);
    domains[entry.domain] ??= { cases: 0, verified: 0 };
    domains[entry.domain].cases += 1;
    if (reason) failures.push({ id: entry.id, domain: entry.domain, reason });
    else domains[entry.domain].verified += 1;
  }
  return { dataset: manifest.dataset, dataClass: manifest.dataClass,
    cases: manifest.entries.length, verified: manifest.entries.length - failures.length,
    domains, failures };
}
