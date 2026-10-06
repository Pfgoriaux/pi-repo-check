import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import extension, { runRepoCheck } from "../extensions/repo-check.ts";

function fixture(t: { after: (fn: () => void) => void }) {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "repo-check-")));
	const previous = process.env.REPO_CHECK_SCRIPT;
	delete process.env.REPO_CHECK_SCRIPT;
	t.after(() => {
		if (previous === undefined) delete process.env.REPO_CHECK_SCRIPT;
		else process.env.REPO_CHECK_SCRIPT = previous;
		fs.rmSync(root, { recursive: true, force: true });
	});
	return root;
}

test("bundled runner works from an unrelated directory without an override", (t) => {
	const root = fixture(t);
	fs.writeFileSync(path.join(root, "AGENTS.md"), "# Instructions\n");
	const before = fs.readdirSync(root);
	const result = runRepoCheck(root);
	assert.ok(!("error" in result));
	assert.equal(result.root, root);
	assert.ok(result.rows.some(row => row.check === "docs-in-pairs"));
	assert.deepEqual(fs.readdirSync(root), before, "checking must not create files");
});

test("error-severity conventions produce parseable JSON and exit 1", (t) => {
	const root = fixture(t);
	fs.writeFileSync(path.join(root, "code.ts"), "forbidden\n");
	fs.writeFileSync(path.join(root, "conventions.json"), JSON.stringify({
		version: "v1", conventions: [{ name: "content", paths: "*.ts", mustNot: { contain: ["forbidden"] } }],
	}));
	const result = runRepoCheck(root);
	assert.ok(!("error" in result));
	assert.equal(result.summary.errors, 1);
	for (const file of ["check-repo.mjs", "check-conventions.mjs"]) {
		const script = new URL(`../scripts/${file}`, import.meta.url);
		const processResult = spawnSync(process.execPath, [script.pathname, "--json"], { cwd: root, encoding: "utf8" });
		assert.equal(processResult.status, 1);
		assert.equal(JSON.parse(processResult.stdout).summary.errors, 1);
	}
});

test("malformed config and broken override errors remain visible", (t) => {
	const root = fixture(t);
	fs.writeFileSync(path.join(root, "conventions.json"), "{");
	const invalid = runRepoCheck(root);
	assert.ok("error" in invalid);
	assert.match(invalid.error, /config problem:.*invalid JSON/);
	process.env.REPO_CHECK_SCRIPT = path.join(root, "missing.mjs");
	assert.match((runRepoCheck(root) as { error: string }).error, /runner not found/);
	const override = path.join(root, "override.mjs");
	fs.writeFileSync(override, "process.stderr.write('override failed'); process.exit(7);");
	process.env.REPO_CHECK_SCRIPT = override;
	assert.match((runRepoCheck(root) as { error: string }).error, /runner failed \(7\): override failed/);
});

test("tool and command use session cwd; missing runner rejects the tool call", async (t) => {
	const root = fixture(t);
	let tool: any;
	let command: any;
	extension({
		registerTool(value: any) { tool = value; },
		registerCommand(_name: string, value: any) { command = value; },
	} as never);
	const notifications: string[] = [];
	const ctx = { cwd: root, ui: { notify: (message: string) => notifications.push(message) } };
	const result = await tool.execute("test", {}, undefined, undefined, ctx);
	assert.equal(result.details.root, root);
	await command.handler("", ctx);
	assert.match(notifications[0], /repo-check:/);
	process.env.REPO_CHECK_SCRIPT = path.join(root, "missing.mjs");
	await assert.rejects(tool.execute("test", {}, undefined, undefined, ctx), /runner not found/);
});

test("bundled convention operators and command checks still run", (t) => {
	const root = fixture(t);
	fs.mkdirSync(path.join(root, "src"));
	fs.writeFileSync(path.join(root, "src", "bad.ts"), "TODO\nline two\n");
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { check: "true" } }));
	fs.writeFileSync(path.join(root, "AGENTS.md"), "`npm run missing`\n");
	fs.writeFileSync(path.join(root, "conventions.json"), JSON.stringify({
		version: "v1", conventions: [
			{ name: "file", paths: "**/*.ts", must: { maxLines: 1, contain: ["required"], fileNameMatches: "good" }, mustNot: { contain: ["TODO"] } },
			{ name: "folder", paths: "src", must: { haveType: "file", haveFiles: ["README.md"] } },
		],
	}));
	const result = runRepoCheck(root);
	assert.ok(!("error" in result));
	assert.equal(result.summary.errors, 6);
	assert.ok(result.rows.some(row => row.check === "commands-resolve"));
});
