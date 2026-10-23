import fs from "node:fs";
export const core = [
  "delivery-steward",
  "test-quality",
  "security-data-integrity",
  "reproducibility",
  "evidence-quality",
  "project-presentation",
];
export const standards = [
  "accessibility",
  "css-colors",
  "design-principles",
  "architecture",
];
export const specialized = [
  "realtime-systems",
  "asset-pipeline",
  "hardware-validation",
];
export const skills = [...core, ...standards, ...specialized];
export const profiles = {
  "qa-tooling": [],
  web: [],
  "static-site": [],
  "realtime-game": ["realtime-systems", "asset-pipeline"],
  research: ["asset-pipeline"],
  assets: ["asset-pipeline"],
  hardware: ["hardware-validation", "asset-pipeline"],
};
export const defaults = {
  version: 1,
  profile: "web",
  integrationBranch: "main",
  agent: "codex",
  thresholds: { warnLines: 400, warnFiles: 20, exceptionLines: 800 },
  paths: {
    generated: [
      "dist/**",
      "build/**",
      "**/package-lock.json",
      "**/uv.lock",
      "**/Cargo.lock",
    ],
    vendor: ["vendor/**", "node_modules/**"],
    captures: ["captures/**"],
    ui: [
      "**/*.html",
      "**/*.css",
      "**/*.scss",
      "**/*.jsx",
      "**/*.tsx",
      "**/*.svg",
    ],
    "realtime-systems": ["src/**", "server/**", "tests/**"],
    "asset-pipeline": [
      "assets/**",
      "exports/**",
      "renders/**",
      "cad/**",
      "kicad/**",
      "tools/**",
    ],
    "hardware-validation": ["cad/**", "kicad/**", "firmware/**", "docs/**"],
  },
  validationCommands: [],
  disabledSkills: [],
  requireVisualEvidence: true,
  sections: {
    Problem: "Problem",
    Behavior: "Behavior",
    Validation: "Validation",
    Risks: "Risks",
    visual: "Visual evidence",
    size: "Size exception",
  },
};
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
export function resolveConfig(raw = {}) {
  if (!object(raw)) throw Error("Configuration must be an object");
  for (const k of Object.keys(raw))
    if (!(k in defaults)) throw Error(`Unknown configuration key: ${k}`);
  const c = {
    ...defaults,
    ...raw,
    thresholds: { ...defaults.thresholds, ...raw.thresholds },
    paths: { ...defaults.paths, ...raw.paths },
    sections: { ...defaults.sections, ...raw.sections },
  };
  if (c.version !== 1 || !Object.hasOwn(profiles, c.profile))
    throw Error("Unsupported version or profile");
  if (
    typeof c.integrationBranch !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(c.integrationBranch) ||
    c.integrationBranch.includes("..")
  )
    throw Error("Invalid integrationBranch");
  if (!["codex", "claude"].includes(c.agent)) throw Error("Invalid agent");
  for (const key of ["thresholds", "paths", "sections"])
    if (raw[key] !== undefined && !object(raw[key]))
      throw Error(`${key} must be an object`);
  for (const [k, v] of Object.entries(c.thresholds))
    if (!(k in defaults.thresholds) || !Number.isInteger(v) || v < 1)
      throw Error("Invalid threshold");
  if (c.thresholds.exceptionLines < c.thresholds.warnLines)
    throw Error("exceptionLines must be >= warnLines");
  for (const [k, v] of Object.entries(c.paths)) {
    if (
      !(k in defaults.paths) ||
      !Array.isArray(v) ||
      v.some(
        (x) =>
          typeof x !== "string" ||
          !x ||
          x.startsWith("/") ||
          x.split("/").includes(".."),
      )
    )
      throw Error(`Invalid path patterns: ${k}`);
  }
  if (
    !Array.isArray(c.disabledSkills) ||
    c.disabledSkills.some((s) => !skills.includes(s))
  )
    throw Error("Invalid disabledSkills");
  if (
    !Array.isArray(c.validationCommands) ||
    c.validationCommands.some((s) => typeof s !== "string" || !s.trim())
  )
    throw Error("Invalid validationCommands");
  if (typeof c.requireVisualEvidence !== "boolean")
    throw Error("Invalid requireVisualEvidence");
  for (const [k, v] of Object.entries(c.sections))
    if (!(k in defaults.sections) || typeof v !== "string" || !v.trim())
      throw Error("Invalid section mapping");
  return c;
}
export function loadConfig(file = ".qa.json") {
  return resolveConfig(JSON.parse(fs.readFileSync(file, "utf8")));
}
export function matches(file, pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        i++;
        out += "(?:.*/)?";
      } else out += ".*";
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[\\^$+?.()|{}[\]]/g, "\\$&");
  }
  return new RegExp(out + "$").test(file);
}
export function selectSkills(config, files, { audit = false } = {}) {
  const selected = new Set(core);
  if (
    audit ||
    files.some(
      (f) =>
        /\.(?:[cm]?[jt]sx?|py|rs|go|cs|gd)$/.test(f) ||
        /(?:package.json|pyproject.toml|Cargo.toml|go.mod)$/.test(f),
    )
  )
    selected.add("architecture");
  if (audit || files.some((f) => config.paths.ui.some((p) => matches(f, p))))
    for (const s of standards.slice(0, 3)) selected.add(s);
  for (const s of profiles[config.profile])
    if (audit || files.some((f) => config.paths[s].some((p) => matches(f, p))))
      selected.add(s);
  return [...selected].filter((s) => !config.disabledSkills.includes(s));
}
