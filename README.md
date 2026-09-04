# pi-repo-check

A [pi](https://pi.dev) package exposing a repo hygiene gate as a
callable tool: `repo_check` for agents, `/repo-check` for humans.

```
agent/human → repo_check tool → node <candidate path>/scripts/check-repo.mjs --json
                                          ↑ canonical, zero-dep, single source of truth
CI · git hooks · npm run check call the same script directly.
```

## What it checks (read-only)

1. `conventions.json` rules — file-size bounds, naming, required siblings,
   content regexes. `severity: "error"` rows fail; `"warning"` rows advise.
2. **docs-in-pairs** — every `AGENTS.md` needs a `README.md` sibling.
3. **commands-resolve** — every command cited in `AGENTS.md` must resolve:
   `npm/pnpm/bun/yarn run` scripts (nearest `package.json`, `--prefix`
   aware), file paths (`node scripts/x.mjs`, `bash ./s.sh`), Makefile
   targets. Dead commands in AGENTS.md burn agent turns — this catches them.
4. **baseline** — LICENSE, a CI workflow, a lockfile next to `package.json`.

First live run already caught real drift: linkedin-scraper's
`db/AGENTS.md` cites `npm run migrate` which exists nowhere, and the repo
has no CI workflow.

## Install

1. `npm install` (typebox dep).
2. Add to `~/.pi/agent/settings.json` `packages`:

```json
"../../dev/pi/extensions/pi-repo-check"
```

3. The runner script is resolved from a small list of candidate paths
   (see `resolveScript()` in `extensions/repo-check.ts`), or set the
   `REPO_CHECK_SCRIPT` env var to point at any compatible
   `check-repo.mjs`.

## Usage

- Agent-side: the `repo_check` tool ("verify repo structure / conventions",
  or before claiming work done in a repo that has a `check` gate).
- Human-side: `/repo-check` → summary notification.

To make a rule block (errors instead of warnings), edit `conventions.json`
in the target repo — that is the only knob, shared by all four consumers
(CI, hooks, `npm run check`, this tool).


## The pi extension family

Five packages, one workflow: plan, fan out, review, protect, verify.

| Package | Job |
|---|---|
| [pi-dispatch](https://github.com/Pfgoriaux/pi-dispatch) | parallel sub-agent fan-out, merge-back, Herdr arborescence |
| [pi-feature-swarm](https://github.com/Pfgoriaux/pi-feature-swarm) | read-only multi-model feature discovery & planning |
| [pi-pr-swarm](https://github.com/Pfgoriaux/pi-pr-swarm) | multi-model PR review, then aggregate & fix |
| [pi-worktree-guard](https://github.com/Pfgoriaux/pi-worktree-guard) | one branch = one worktree = one agent |
| [pi-repo-check](https://github.com/Pfgoriaux/pi-repo-check) | repo hygiene gate: conventions, docs-in-pairs, baseline |
