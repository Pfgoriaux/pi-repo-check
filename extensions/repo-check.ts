/**
 * repo-check — expose a repo hygiene gate to pi agents as a tool.
 *
 * The logic lives in exactly one place: a `check-repo.mjs` runner script
 * (zero-dep Node — see README for a compatible implementation).
 * This extension is a thin callable wrapper: tool `repo_check`
 * for agents, `/repo-check` for humans. CI, git hooks, and `npm run check`
 * call the same script directly, so every consumer shares one definition of
 * "clean".
 *
 * What the gate enforces (all read-only, no files are modified):
 *   - conventions.json rules (file size, naming, siblings, content regexes;
 *     severity "error" rules fail the check, "warning" rules advise)
 *   - docs-in-pairs: every AGENTS.md needs a README.md sibling
 *   - commands-resolve: every command cited in AGENTS.md must resolve
 *     (package.json scripts, file paths, Makefile targets)
 *   - baseline: LICENSE, CI workflow, lockfile next to package.json
 *
 * The canonical script path:
 *   1. `REPO_CHECK_SCRIPT` env var if set
 *   2. `~/eden/tools/repo-template/scripts/check-repo.mjs` (author's layout;
 *      override with the env var on your machine)
 *
 * It runs against the repo the session is in (process cwd).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface CheckRow {
	check: string;
	rel: string;
	severity: "error" | "warning";
	detail: string;
}

interface RepoCheckResult {
	root: string;
	rows: CheckRow[];
	configWarnings: string[];
	summary: {
		checkedPaths: number;
		conventions: number;
		errors: number;
		warnings: number;
	};
}

function resolveScript(): string {
	return (
		process.env.REPO_CHECK_SCRIPT ??
		path.join(os.homedir(), "eden", "tools", "repo-template", "scripts", "check-repo.mjs")
	);
}

export function runRepoCheck(cwd: string): RepoCheckResult | { error: string } {
	const script = resolveScript();
	if (!fs.existsSync(script)) {
		return {
			error: `runner not found at ${script} — set REPO_CHECK_SCRIPT to a compatible check-repo.mjs`,
		};
	}
	const proc = spawnSync("node", [script, "--json"], { encoding: "utf8", cwd });
	if (proc.error) {
		return { error: `failed to run node: ${proc.error.message}` };
	}
	if (proc.status === 2) {
		return { error: `config problem: ${proc.stdout.trim()}` };
	}
	try {
		return JSON.parse(proc.stdout) as RepoCheckResult;
	} catch (err) {
		return { error: `unparseable runner output: ${(err as Error).message}` };
	}
}

function formatReport(result: RepoCheckResult): string {
	const lines: string[] = [];
	for (const w of result.configWarnings) lines.push(`config  WARNING ${w}`);
	for (const r of result.rows) {
		lines.push(`${r.severity.toUpperCase().padEnd(7)} ${r.check.padEnd(24)} ${r.rel} — ${r.detail}`);
	}
	const s = result.summary;
	lines.push(
		`\nRepo check — conventions on ${s.checkedPaths} paths. Found ${s.errors} errors, ${s.warnings} warnings.`,
	);
	if (s.errors > 0) {
		lines.push(
			"NOT CLEAN — fix the ERROR rows before claiming the work done; warnings are advisory (severity can be tuned in conventions.json).",
		);
	}
	return lines.join("\n");
}

const Params = Type.Object({}, { additionalProperties: false });

export default function repoCheckExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "repo_check",
		label: "Repo check",
		description:
			"Run the repo hygiene gate for this repository: conventions.json structural rules (file size, naming, required files), docs-in-pairs (AGENTS.md/README.md), AGENTS.md cited-command resolution, and baseline (LICENSE, CI, lockfile). Read-only. Use when asked to verify repo structure or conventions, or before claiming work is done in a repo that has one.",
		parameters: Params,
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const result = runRepoCheck(process.cwd());
			if ("error" in result) {
				return { content: [{ type: "text" as const, text: `repo_check failed: ${result.error}` }] };
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `repo_check on ${result.root}\n\n${formatReport(result)}`,
					},
				],
			};
		},
	});

	pi.registerCommand("repo-check", {
		description: "Run the repo hygiene gate (conventions, docs-in-pairs, AGENTS.md command resolution)",
		handler: async (_args, ctx) => {
			const result = runRepoCheck(process.cwd());
			if ("error" in result) {
				ctx.ui.notify(result.error, "error");
				return;
			}
			const s = result.summary;
			const kind = s.errors > 0 ? "error" : s.warnings > 0 ? "warning" : "info";
			ctx.ui.notify(`repo-check: ${s.errors} errors, ${s.warnings} warnings`, kind);
		},
	});
}
