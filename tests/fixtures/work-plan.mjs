
export function milestone() {
  return { id: "demo", title: "A bounded demo", scope: "Fix the demo and verify its behavior.",
    allowedPaths: ["src/**", "evidence/**"], finalChecks: ["test"],
    criteria: [{ id: "correct", description: "Behavior is correct", kind: "automated", done: false, evidence: [], checks: ["test"] },
      { id: "feel", description: "Human accepts the result", kind: "human", done: false, evidence: [], checks: [] }],
    tasks: [{ id: "fix", title: "Fix the behavior", kind: "implementation", criteria: ["correct"], dependencies: [], capabilities: [], checks: ["test"], priority: 1 }] };
}
