import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { git, commit } from "../lib/git.mjs";
import { runtimeEntries, digest } from "../lib/install.mjs";

export function packageRelease(root, output, ref = "HEAD") {
  const sha = commit(root, ref);
  const pkg = JSON.parse(git(root, ["show", `${sha}:package.json`]));
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version)) throw Error("Invalid release version");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "qa-release-"));
  try {
    const archive = gitArchive(root, sha);
    const tar = path.join(temp, "source.tar");
    fs.writeFileSync(tar, archive);
    const stage = path.join(temp, "qa");
    fs.mkdirSync(stage);
    execFileSync("tar", ["-xf", tar, "-C", stage]);
    fs.writeFileSync(path.join(stage, "release.json"), JSON.stringify({ version: 1, sourceSha: sha, releaseVersion: pkg.version }) + "\n");
    fs.mkdirSync(output, { recursive: true });
    const filename = `qa-${pkg.version}.tar.gz`, target = path.resolve(output, filename);
    execFileSync("tar", ["-czf", target, "-C", temp, "qa"]);
    fs.writeFileSync(target + ".sha256", `${digest(fs.readFileSync(target))}  ${filename}\n`);
    return { target, sourceSha: sha };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function gitArchive(root, sha) {
  return execFileSync("git", ["-C", root, "archive", sha, ...runtimeEntries], { maxBuffer: 64 * 1024 * 1024 });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify(packageRelease(root, path.resolve(process.argv[2] || "dist"), process.argv[3] || "HEAD")));
}
