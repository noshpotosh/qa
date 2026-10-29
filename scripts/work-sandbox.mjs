import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { safePath } from "../lib/install.mjs";
import { git } from "../lib/git.mjs";
import { runProcess, processEnvironment } from "./work-process.mjs";

const quote = JSON.stringify;
function npmRuntimePaths() {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const executable = path.join(directory, "npm");
    if (!fs.existsSync(executable)) continue;
    const source = fs.realpathSync(executable), root = path.dirname(path.dirname(source));
    try {
      if (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name === "npm") return [executable, root];
    } catch { /* Only admit a recognized installed npm runtime, never its parent. */ }
    break;
  }
  return [];
}
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function provisionRuntime(home, runtime) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  for (const [name, executable] of [["node", process.execPath], ["sh", "/bin/sh"]]) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec ${shellQuote(executable)} "$@"\n`, { mode: 0o700 });
  }
  // macOS may deny exec through a system symlink even when its target is
  // readable. A controller-owned launcher uses the actual Node/npm entrypoint.
  if (runtime.length) fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(runtime[1], "bin/npm-cli.js"))} "$@"\n`, { mode: 0o700 });
  return bin;
}
const runtimePath = (home) => path.join(home, "bin") + path.delimiter + (process.env.PATH || "/usr/bin:/bin");
export function profileText({ workspace, directory, common, resources = [], readRoots = [], protectedPaths = [], writable = true, network = false }) {
  const home = path.join(directory, "scratch");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const entries = new Map([[":minimal", "read"],
    [common, "read"], [directory, "deny"], [home, "write"]]);
  if (process.platform === "darwin") entries.set("/System/Library/OpenSSL", "read");
  const npm = npmRuntimePaths(), bin = provisionRuntime(home, npm);
  if (npm.length) entries.set(assertReadRoot(npm[1]), "read");
  entries.set(bin, "read");
  for (const root of readRoots) entries.set(assertReadRoot(root), "read");
  for (const resource of resources) {
    entries.set(assertReadRoot(resource.source), "read");
    entries.set(path.join(workspace, resource.target), "read");
  }
  for (const name of [".codex", ".aws", ".ssh", ".config/gh"]) entries.set(path.join(os.homedir(), name), "deny");
  for (const name of [".git/config", "config"]) entries.set(path.join(common, name), "deny");
  const filesystem = Object.fromEntries(entries);
  filesystem[workspace] = { ".": writable ? "write" : "read", ".git": "read",
    "**/.env*": "deny", ".qa.json": "read", ".qa-work.json": "read",
    ".github": "read", ".codex": "read", "**/AGENTS.md": "deny", "**/AGENTS.override.md": "deny", "**/CLAUDE.md": "deny" };
  for (const name of protectedPaths) filesystem[workspace][name] = "read";
  // Instructions are snapshotted by the controller and supplied in the prompt.
  // Avoid CLI discovery trying to open deliberately denied control files.
  const config = { default_permissions: "qa-run", approval_policy: "never", web_search: "disabled",
    project_doc_max_bytes: 0, project_doc_fallback_filenames: [],
    features: { apps: false, multi_agent: false }, mcp_servers: {},
    permissions: { "qa-run": { filesystem, network: { enabled: network } } },
    shell_environment_policy: { inherit: "none", set: { PATH: runtimePath(home), HOME: home, TMPDIR: home } } };
  return Object.entries(config).map(([key, value]) => `${key} = ${inlineTOML(value)}`).join("\n") + "\n";

}
function assertReadRoot(root) {
  const source = fs.realpathSync(root);
  for (const name of [".codex", ".aws", ".ssh", ".config/gh"]) {
    const credential = path.join(os.homedir(), name);
    if (source === credential || source.startsWith(credential + path.sep)) throw Error("Credential stores cannot be declared as task inputs");
  }
  return source;
}
export function sandboxHome(context, options = {}) {
  const directory = path.join(context.directory, `sandbox-${options.writable === false ? "read" : "write"}-${options.network ? "net" : "offline"}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const config = profileText({ ...context, ...options });
  fs.writeFileSync(path.join(directory, "config.toml"), config, { mode: 0o600 });
  return { directory, config };
}
function inlineTOML(value) {
  if (Array.isArray(value)) return "[" + value.map(inlineTOML).join(", ") + "]";
  if (value && typeof value === "object") return "{ " + Object.entries(value)
    .map(([key, child]) => `${quote(key)} = ${inlineTOML(child)}`).join(", ") + " }";
  return JSON.stringify(value);
}
export function configOverrides(text) {
  return text.trim().split("\n").flatMap((line) => ["-c", line]);
}
export async function sandboxCommand(context, argv, options) {
  const profile = sandboxHome(context, options);
  return runProcess([context.codex, "sandbox", "-C", context.workspace,
    "--permission-profile", "qa-run", "--", ...argv], {
    ...options, cwd: context.workspace,
    env: { ...processEnvironment(), CODEX_HOME: profile.directory, PATH: runtimePath(path.join(context.directory, "scratch")), HOME: path.join(context.directory, "scratch"), TMPDIR: path.join(context.directory, "scratch") },
  });
}
export function provisionInputs(context) {
  const exclude = path.resolve(context.workspace, git(context.workspace, ["rev-parse", "--git-path", "info/exclude"]).trim());
  for (const resource of context.resources) {
    const pattern = `/${resource.target}`;
    if (!fs.readFileSync(exclude, "utf8").split("\n").includes(pattern)) fs.appendFileSync(exclude, `\n${pattern}\n`);
    const target = path.join(context.workspace, resource.target);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      if (fs.realpathSync(target) !== fs.realpathSync(resource.source)) throw Error("Input link changed");
      continue;
    }
    safePath(context.workspace, resource.target);
    const source = fs.realpathSync(resource.source);
    if (source.startsWith(context.workspace + path.sep)) throw Error("Input source cannot point into the owned workspace");
    if (fs.existsSync(target)) {
      if (!fs.lstatSync(target).isSymbolicLink() || fs.readlinkSync(target) !== source) throw Error(`Resource target exists: ${resource.target}`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target);
  }
}
export function assertInputs(context) {
  for (const resource of context.resources) {
    const target = path.join(context.workspace, resource.target);
    if (!fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== fs.realpathSync(resource.source)) throw Error("Declared input mapping changed");
  }
}
