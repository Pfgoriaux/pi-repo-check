# AGENTS.md

`pi-repo-check` exposes a repo hygiene gate as a pi tool: `repo_check` for
agents, `/repo-check` for humans. It exists because drift between what an
AGENTS.md claims and what a repo actually has burns agent turns silently —
this makes the drift loud and read-only.

## Essentials

- Single-file extension: `extensions/repo-check.ts` (pi loads it directly —
  no build step).
- One runtime dep (`typebox`) — lockfile committed, `node_modules/`
  ignored.

## Non-obvious rules

- The check logic lives in exactly one place, outside this repo:
  `scripts/check-repo.mjs`. This repo is a thin wrapper — **never
  duplicate check logic here**. The runner is resolved from a small list
  of candidate paths (`extensions/repo-check.ts`), or pointed anywhere
  with the `REPO_CHECK_SCRIPT` env var. When none resolves, the tool
  says so instead of silently checking less.
- Read-only by construction: never write to the repo being checked.
- The extension must pass its own gate (docs in pairs, LICENSE, lockfile).
