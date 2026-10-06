# pi-repo-check

A [pi](https://pi.dev) package exposing a repository hygiene runner:
`repo_check` for agents and `/repo-check` for humans. It runs the bundled script
against the session's working directory and reports the result without modifying
the repository.

## Checks

The bundled `scripts/check-repo.mjs` runner checks:

- `conventions.json`: path, size, naming, sibling, and content rules. Rules with
  severity `error` fail the check; `warning` rules are advisory.
- Documentation pairing: warns when an `AGENTS.md` lacks a README sibling.
- Cited commands: checks supported script and file-command patterns in AGENTS.md.
  This is heuristic resolution, not execution or proof that every shell command works.
- Baseline: warns about a missing license, GitHub workflow, or root package lockfile.

The runner does not execute lint, typechecking, or behavior tests, and does not
verify that a workflow runs them. Calling the tool is not equivalent to CI
blocking a merge. Repos must wire their own checks into scripts, hooks, and CI.

## Install and configure

```bash
pi install git:github.com/Pfgoriaux/pi-repo-check
# Or this workspace's local checkout:
pi install /Users/pf/eden/tools/pi/extensions/pi-repo-check
```

Local checkout development requires its dependencies (`npm install` from that
repo). Reload or restart pi after installation.

Runner resolution is exactly:

1. `REPO_CHECK_SCRIPT`, when set.
2. Otherwise, this package's `scripts/check-repo.mjs`.

No workspace-specific path is required. To use another trusted runner:

```bash
export REPO_CHECK_SCRIPT=/absolute/path/to/check-repo.mjs
pi
```

An override must be a trusted compatible runner. It executes
with your user's privileges. Setting it in an agent's child shell does not change
the environment of an already-running pi process.

## Usage and scope

- Ask pi to run `repo_check`, or use `/repo-check` for a summary notification.
- Run it from the repository being checked. `eden/` itself is a workspace, not an
  application repo; generic root license/CI/package checks do not establish its health.
- A missing runner produces an error. Warnings remain warnings; `conventions.json`
  severity applies to structural rules, not to every hardcoded baseline check.
- For direct checks, the runner accepts a target root:

```bash
node scripts/check-repo.mjs /path/to/repo --json
```

## Related packages

[pi-dispatch](https://github.com/Pfgoriaux/pi-dispatch) delegates work, plans
features, and reviews PRs,
and [pi-worktree-guard](https://github.com/Pfgoriaux/pi-worktree-guard) guards
selected conflicting Git operations. Each has separate permissions and limits.
