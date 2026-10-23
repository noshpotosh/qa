---
name: architecture
description: Architecture and code-structure standard. Use when adding modules, changing dependencies between layers, introducing new libraries, or reviewing structural changes.
---

# Architecture standard

Replace the layers below with your real ones, or override per repo in that repo's AGENTS.md.

## Layers (dependencies point down only)
`ui -> features -> domain -> lib`
- `domain` has no framework or I/O imports.
- `ui` never calls the network or database directly; it goes through `features`.
- No circular imports between modules.

## Blocking
- A dependency that points up a layer, or a new cycle.
- A new third-party dependency without a sentence in the PR on why an existing one won't do.
- Secrets, URLs or environment-specific values hardcoded outside config.

## Should fix
- Files over ~400 lines or functions over ~60 lines that the PR made bigger.
- Duplicated logic that already exists elsewhere (name where).
- Public module APIs changed without updating callers' tests.

## Enforce mechanically too
dependency-cruiser (JS/TS) or import-linter (Python) for layer rules and cycles.
