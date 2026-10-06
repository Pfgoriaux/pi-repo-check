# pi-repo-check

A pi tool exposing a read-only repository hygiene runner. It detects drift between
instructions and repository structure; it does not run lint, typechecking, or
behavior tests. Installation and runner setup: [README.md](README.md).

## Constraints

- `extensions/repo-check.ts` registers `repo_check` and `/repo-check`; pi loads
  the file directly, with no build step.
- Keep check logic in `scripts/check-repo.mjs` and `scripts/check-conventions.mjs`.
  The extension and direct CLI checks use the same bundled runner.
  Set `REPO_CHECK_SCRIPT` before starting pi to use a different trusted runner.
  A missing runner is an error, not a successful partial audit.
- The compatible workspace runner treats baseline and command-resolution findings
  as warnings. Error-severity structural conventions can fail the check.
  Do not describe this wrapper as enforcing every documented rule.
- Keep the runner read-only and its `--json` stdout parseable on both exit 0
  and exit 1. Configuration errors go to stderr and exit 2.
- `npm run check` runs fixture-based tests and the bundled hygiene check.
