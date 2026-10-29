import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { git } from "./git.mjs";

export const runtimeEntries = ["bin", "lib", "scripts", "skills", "profiles", "instructions", "package.json"];
export const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
export function safePath(root, name) {
  let p = path.resolve(root);
  for (const part of ["", ...name.split("/")]) {
    if (part) p = path.join(p, part);
    let stat;
    try { stat = fs.lstatSync(p); } catch (e) { if (e.code !== "ENOENT") throw e; }
    if (stat?.isSymbolicLink()) throw Error(`Refusing symlink: ${name}`);
  }
  return p;
}
export function sourceRef(root) {
  const manifest = path.join(root, "release.json");
  const ref = fs.existsSync(manifest)
    ? JSON.parse(fs.readFileSync(manifest, "utf8")).sourceSha
    : git(root, ["rev-parse", "HEAD"]).trim();
  if (!/^[0-9a-f]{40}$/.test(ref)) throw Error("Invalid release source SHA");
  return ref;
}
export function runtimeFiles(root) {
  const files = {};
  function visit(name) {
    const p = safePath(root, name), stat = fs.lstatSync(p);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(p).sort()) visit(`${name}/${child}`);
    } else if (stat.isFile()) files[name] = fs.readFileSync(p);
    else throw Error(`Unsupported runtime entry: ${name}`);
  }
  runtimeEntries.forEach(visit);
  return files;
}
export function planRuntime(root, source, ref) {
  const destination = safePath(root, ".qa");
  if (path.resolve(source) === destination) return [];
  const marker = safePath(root, ".qa/.qa-install.json");
  if (fs.existsSync(destination) && !fs.existsSync(marker))
    throw Error("Existing .qa is not a managed installation; move it aside explicitly before installing.");
  const files = runtimeFiles(source);
  const manifest = { version: 1, sourceSha: ref, files: {} };
  const previous = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : null;
  if (previous) {
    if (previous.version !== 1 || !previous.files || typeof previous.files !== "object")
      throw Error("Invalid .qa installation record");
    for (const [name, hash] of Object.entries(previous.files)) {
      if (name.startsWith("/") || name.split("/").some((p) => ["..", "", "."].includes(p)))
        throw Error("Invalid managed runtime path");
      const p = safePath(root, `.qa/${name}`);
      if (!fs.existsSync(p) || digest(fs.readFileSync(p)) !== hash)
        throw Error(`Managed runtime edited: .qa/${name}; preserve your changes before upgrading.`);
    }
    for (const name of Object.keys(files)) {
      if (!Object.hasOwn(previous.files, name) && fs.existsSync(safePath(root, `.qa/${name}`)))
        throw Error(`Unmanaged runtime file: .qa/${name}`);
    }
  }
  const changes = Object.entries(files).map(([name, content]) => {
    manifest.files[name] = digest(content);
    const p = safePath(root, `.qa/${name}`);
    return { path: `.qa/${name}`, action: !fs.existsSync(p) ? "create" : digest(fs.readFileSync(p)) === manifest.files[name] ? "preserve" : "update", content };
  });
  for (const name of Object.keys(previous?.files || {})) {
    if (!Object.hasOwn(files, name)) changes.push({ path: `.qa/${name}`, action: "delete" });
  }
  for (const [name, content] of Object.entries({ "release.json": JSON.stringify({ version: 1, sourceSha: ref }) + "\n", ".qa-install.json": JSON.stringify(manifest, null, 2) + "\n" })) {
    const p = safePath(root, `.qa/${name}`);
    changes.push({ path: `.qa/${name}`, action: fs.existsSync(p) && fs.readFileSync(p, "utf8") === content ? "preserve" : fs.existsSync(p) ? "update" : "create", content });
  }
  return changes;
}
export function inspectRepository(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const configFile = safePath(root, ".qa.json");
  const existing = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  let branch = existing.integrationBranch;
  if (!branch) {
    try { branch = git(root, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]).trim().replace(/^refs\/remotes\/origin\//, ""); } catch { /* no remote default */ }
  }
  if (!branch) {
    const candidates = git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).trim().split("\n").filter(Boolean);
    if (candidates.length === 1) branch = candidates[0];
    if (!candidates.length) branch = git(root, ["symbolic-ref", "--short", "HEAD"]).trim();
  }
  let profile = existing.profile;
  if (!profile) {
    const p = path.join(root, "package.json");
    if (fs.existsSync(p)) {
      const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (pkg.name === "@noshpotosh/qa") profile = "qa-tooling";
      else if (["react", "next", "vue", "svelte"].some((name) => name in { ...pkg.dependencies, ...pkg.devDependencies })) profile = "web";
    } else if (fs.existsSync(path.join(root, "index.html"))) profile = "static-site";
  }
  const workflows = path.join(root, ".github/workflows");
  return { root, branch: branch || null, profile: profile || null, workflows: fs.existsSync(workflows) ? fs.readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f)) : [] };
}
