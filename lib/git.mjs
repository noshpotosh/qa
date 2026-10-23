import { execFileSync } from "node:child_process";
export function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}
export function commit(cwd, ref) {
  return git(cwd, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]).trim();
}
export function parseNumstat(text) {
  const chunks = text.split("\0"),
    files = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i]) continue;
    const m = chunks[i].match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/);
    if (!m) throw Error("Invalid git numstat");
    let path = m[3],
      previousPath;
    if (!path) {
      previousPath = chunks[++i];
      path = chunks[++i];
    }
    if (!path) throw Error("Missing diff path");
    files.push({
      path,
      ...(previousPath ? { previousPath } : {}),
      binary: m[1] === "-",
      added: m[1] === "-" ? 0 : Number(m[1]),
      deleted: m[2] === "-" ? 0 : Number(m[2]),
    });
  }
  return files;
}
export function diffContext(cwd, { staged = false, base, head = "HEAD" } = {}) {
  if (staged && base) throw Error("Use staged OR base/head");
  if (!staged && !base)
    throw Error("Specify --staged or --base; no implicit main");
  const target = staged
    ? ["--cached"]
    : [`${commit(cwd, base)}...${commit(cwd, head)}`];
  const files = parseNumstat(
    git(cwd, ["diff", "--numstat", "-z", "--find-renames", ...target, "--"]),
  );
  const patch = git(cwd, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    ...target,
    "--",
  ]);
  const limit = 120000;
  return {
    mode: staged ? "staged" : "pr",
    base: base || null,
    head: staged ? null : commit(cwd, head),
    files,
    patch: patch.slice(0, limit),
    coverage:
      patch.length > limit
        ? [
            "Patch truncated at 120000 characters; inspect relevant files before concluding.",
          ]
        : [],
    commits: staged
      ? []
      : git(cwd, [
          "log",
          "--format=%h %s",
          `${commit(cwd, base)}..${commit(cwd, head)}`,
        ])
          .trim()
          .split("\n")
          .filter(Boolean),
  };
}
