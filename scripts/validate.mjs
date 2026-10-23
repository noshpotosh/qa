import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { skills, resolveConfig } from "../lib/config.mjs";
const names = ["quality-review", ...skills];
for (const name of names) {
  const text = fs.readFileSync(`skills/${name}/SKILL.md`, "utf8");
  if (
    !text.startsWith(`---\nname: ${name}\ndescription: `) ||
    !text.includes("\n---\n")
  )
    throw Error(`Invalid manifest: ${name}`);
}
const reviewer = fs.readFileSync("skills/quality-review/SKILL.md", "utf8");
for (const name of skills)
  if (!reviewer.includes("`" + name + "`"))
    throw Error(`Missing routing: ${name}`);
for (const file of fs.readdirSync(".claude-plugin"))
  if (file.endsWith(".json"))
    JSON.parse(fs.readFileSync(".claude-plugin/" + file));
for (const file of fs.readdirSync("profiles"))
  if (file.endsWith(".json"))
    resolveConfig(JSON.parse(fs.readFileSync("profiles/" + file)));
resolveConfig(JSON.parse(fs.readFileSync(".qa.json")));
for (const dir of ["bin", "lib", "scripts", "tests"])
  for (const file of fs.readdirSync(dir))
    if (file.endsWith(".mjs"))
      execFileSync(process.execPath, ["--check", dir + "/" + file]);
console.log(
  `Validated ${names.length} skills, routing, configuration, plugin JSON and JavaScript syntax.`,
);
