# Configuration and review contracts

`.qa.json` has `version: 1`. Unknown fields fail validation. See `profiles/*.json` for minimal examples; omitted values use the defaults in `lib/config.mjs`.

| Field | Meaning |
|---|---|
| `profile` | qa-tooling, web, static-site, realtime-game, research, assets, hardware |
| `integrationBranch` | Explicit local/audit target; PR metadata must match |
| `agent` | Local preference; set the reusable workflow's agent input to the same value |
| `thresholds` | warnLines 400, warnFiles 20, exceptionLines 800; strict greater-than boundaries |
| `paths` | Arrays of repository-relative glob patterns; `*` matches within a segment, `**` crosses segments |
| `disabledSkills` | Explicit skill exclusions; does not disable deterministic policy checks |
| `validationCommands` | Documented commands for humans and ordinary CI; never executed by the review CLI |
| `repair` | Disabled by default; explicit container validation commands, digest-pinned image and required CI checks for [requested repairs](repairs.md) |
| `requireVisualEvidence` | Require an evidence URL or an explicit unavailable explanation for matched UI changes |
| `sections` | Map Problem, Behavior, Validation, Risks, visual and size to headings in an existing PR template |

Path groups are `generated`, `vendor`, `captures`, `ui`, and the three specialized skill names. Supplied group arrays replace that group's defaults. Binary changes are counted separately first, then vendor, generated, captures, authored. Renames count once, using the destination path. Deletions count as changed lines. Excluded categories remain visible in reports. Do not classify handwritten source as generated just to lower a score.

Skill selection is conservative: core skills always considered, architecture for code/manifests, UI standards for matched UI paths, specialized skills only for a matching profile and path. Audit considers all skills enabled by its profile. JavaScript that renders UI must be included in the repo's `ui` patterns when extension-based defaults do not identify it.

PR headings may be mapped to existing templates (for example Validation → How to Test). If an existing template lacks a required concept, extend it deliberately; init never overwrites it. Required sections need substantive text; HTML comment placeholders do not count. Visual evidence accepts an HTTP(S) URL or `Unavailable: <specific explanation>`. The checker validates structure, not screenshot contents or test claims.

Configuration precedence: shared defaults, then explicit repo JSON values. Repository AGENTS/CLAUDE instructions govern agent judgment. If prose conflicts with machine settings, report the conflict and reconcile configuration; do not bypass the gate. CI reads policy from the PR base commit, validates any proposed head configuration, and uses shared defaults during first adoption. Policy changes therefore take effect on later PRs after owner review.

Reports contain status (passed/failed/skipped/unavailable), summary, coverage limitations and findings. Each finding has ruleId, skill, severity (blocking/suggestion), location, evidence and fix. A blocking agent finding does not grant merge authority. Machine policy reports and agent reports are stored separately in the final artifact.

The coordinator supports planning conversationally; `qa check` supplies deterministic staged/PR context. The CLI does not invoke a paid model. Weekly audits sample tracked source; models must state inspected areas and omitted validation. Patches over 120,000 characters are truncated with an explicit coverage warning and source inspection remains available.
