import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { git } from "../lib/git.mjs";
import { fingerprint, allowedChange, relativePath } from "../lib/work-plan.mjs";
import { safePath } from "../lib/install.mjs";

export function fileHash(file) {
  const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, read));
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}
export function workspaceSnapshot(root, excluded = []) {
  const files = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
  const result = {};
  for (const name of [...new Set(files)].sort()) {
    if (excluded.includes(name)) continue;
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const stat = fs.lstatSync(file);
    result[name] = stat.isSymbolicLink() ? { link: fs.readlinkSync(file) } : { hash: fileHash(file), executable: !!(stat.mode & 0o111) };
  }
  return result;
}
function blobSnapshot(root, oid, mode, file) {
  const fd = fs.openSync(file, "w", 0o600);
  try { execFileSync("git", ["-C", root, "cat-file", "blob", oid], { stdio: ["ignore", fd, "pipe"], maxBuffer: 1024 * 1024 }); }
  finally { fs.closeSync(fd); }
  if (mode === "120000") {
    if (fs.statSync(file).size > 4096) throw Error("Unsupported oversized symlink");
    return { link: fs.readFileSync(file, "utf8") };
  }
  return { hash: fileHash(file), executable: mode === "100755" };
}
function gitSnapshot(root, indexed) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "qa-blob-")), result = {};
  try {
    const rows = git(root, indexed ? ["ls-files", "--stage", "-z"] : ["ls-tree", "-rz", "HEAD"]).split("\0").filter(Boolean);
    for (const row of rows) {
      const match = indexed ? /^(\d+) ([0-9a-f]+) (\d+)\t([\s\S]+)$/.exec(row) : /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(row);
      if (!match || (indexed ? match[3] !== "0" || match[1] === "160000" : match[2] !== "blob")) throw Error("Unmerged or unsupported Git entry");
      result[match[4]] = blobSnapshot(root, indexed ? match[2] : match[3], match[1], path.join(temporary, "blob"));
    }
    return result;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
export const headSnapshot = (root) => gitSnapshot(root, false);
export const indexSnapshot = (root) => gitSnapshot(root, true);
export function resourceIdentity(resources) {
  const result = [];
  function visit(source, relative) {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw Error(`Input contains a symlink: ${relative}`);
    if (stat.isDirectory()) for (const child of fs.readdirSync(source).sort()) visit(path.join(source, child), `${relative}/${child}`);
    else if (stat.isFile()) result.push({ path: relative, hash: fileHash(source) });
    else throw Error("Unsupported input resource");
  }
  for (const resource of resources) visit(fs.realpathSync(resource.source), resource.id);
  return fingerprint(result);
}
export function changedFiles(before, after, milestone, protectedPaths) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((name) => fingerprint(before[name] ?? null) !== fingerprint(after[name] ?? null));
  for (const name of changed) {
    if (!allowedChange(name, milestone, protectedPaths) || after[name]?.link) throw Error(`Unapproved change: ${name}`);
  }
  return changed;
}
export function captureArtifacts(root, names) {
  return [...new Set(names)].map((name) => {
    relativePath(name);
    const file = safePath(root, name), stat = fs.statSync(file);
    if (!stat.isFile()) throw Error(`Expected regular evidence file: ${name}`);
    return { path: name, sha256: fileHash(file), bytes: stat.size };
  });
}
export function retainArtifacts(root, directory, id, artifacts) {
  return artifacts.map((artifact) => {
    const storedPath = `artifacts/${id}/${artifact.path}`;
    const destination = safePath(directory, storedPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(safePath(root, artifact.path), destination, fs.constants.COPYFILE_EXCL);
    if (fileHash(destination) !== artifact.sha256) throw Error("Artifact changed during evidence capture");
    return { ...artifact, storedPath };
  });
}
