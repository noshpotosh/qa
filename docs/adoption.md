# Project adoption inventory

Read-only inventory from the local workspaces. These commands were discovered, not all executed. Fresh GitHub settings and current source must be checked at adoption time.

| Project / remote | Profile | Existing validation / prerequisites |
|---|---|---|
| qa / noshpotosh/qa | qa-tooling | npm test; npm run check; actionlint; main |
| portfolio / noshpotosh/site | static-site | Remote main has only index.html. Navigation/physics tests exist only in unpublished local work; defer those CI jobs until the source lands. Browser checks also need reproducible Playwright setup. Preserve local work. |
| controlla / noshpotosh/controlla | realtime-game | Node 24: npm ci, typecheck, lint, test, build already in CI. Pilot targets develop by owner decision; hardware latency remains unverified. |
| odysseus | web | Existing CI, PR-description checks and template; target dev. Map template sections, preserve upstream policy and existing checks. Determine focused Python tests from changed modules. |
| hub | realtime-game | client/: npm test, npm run check, npm run assets:ci. Current slice has no multiplayer; disable realtime skill until a matching implementation exists. |
| ihtml | web | npm run build; npm test; requires Playwright browser setup. Confirm Git remote/history before adoption. |
| ware-wolf | web | office/: npm test; multiple game/theme areas need separate path routing. Preserve founder merge authority and one-concern PR policy. Add asset profile if reviewing assets separately. |
| thps4 | research | Python capture/analysis tools and Unity checks; define focused commands and generated capture classifications before CI adoption. Large raw datasets require separate provenance review. |
| mh-comp | research | Python tools and research fixtures; identify focused commands per subsystem. Preserve reference-versus-inferred semantics. |
| sheep | research | npm test; npm run check. Confirm Git history/remote and classify disc inputs and extracted assets before adoption. |
| blenda | assets | make doctor; make verify; make check-mcp. Requires Blender/local bridge and export source; not ordinary hosted CI. Confirm Git history/remote. |
| keeb | hardware | Define KiCad ERC/DRC and CAD measurement commands from tool versions; source geometry must not be blanket-excluded as generated. Manufacturing acceptance remains separate. |
| reverse | none yet | Empty local directory; no adoption changes. |

Only qa, site and controlla are pilots. Other rows are prepared guidance, not authorization to overwrite their files or publish them. API-secret names were inspected in the three pilots and no provider keys were configured at implementation start; values were never read.
