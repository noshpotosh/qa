import fs from "node:fs";
export function applyQaAcceptance(seed) {
  const { accepted } = JSON.parse(fs.readFileSync(new URL("./qa-acceptance.json", import.meta.url), "utf8"));
  const { bindings } = JSON.parse(fs.readFileSync(new URL("../.qa-tracker.json", import.meta.url), "utf8"));
  for (const id of accepted) {
    const binding = bindings.find((item) => item.id === id);
    const card = seed.items.find((item) => item.id === binding?.card);
    const check = card?.checks[binding?.phase]?.find((item) => item.label === binding.label);
    if (!check) throw Error(`Cannot apply acceptance without its original criterion: ${id}`);
    check.done = true;
  }
  return seed;
}
