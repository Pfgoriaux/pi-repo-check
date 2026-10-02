# pi-repo-check

A pi tool exposing a read-only repository hygiene runner. It detects drift between
instructions and repository structure; it does not run lint, typechecking, or
behavior tests. Installation and runner setup: [README.md](README.md).

## Constraints

- `extensions/repo-check.ts` registers `repo_check` and `/repo-check`; pi loads
  the file directly, with no build step.
- Keep check logic in the external runner rather than duplicating it here.
  Resolution is `REPO_CHECK_SCRIPT`, otherwise one hardcoded default path.
- The default runner is `~/eden/tools/repo-template/scripts/check-repo.mjs`.
  Set `REPO_CHECK_SCRIPT` before starting pi to use a different trusted runner.
  A missing runner is an error, not a successful partial audit.
- The compatible workspace runner treats baseline and command-resolution findings
  as warnings. Error-severity structural conventions can fail the check.
  Do not describe this wrapper as enforcing every documented rule.
- Keep the runner read-only. No check script or automated tests are configured
  in this wrapper repo; the runner has its own tests in `tools/repo-template/`
  relative to the workspace root.
