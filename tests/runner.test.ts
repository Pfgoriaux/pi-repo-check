import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkCommand, runRepoCheck } from "../scripts/check-repo.mjs";
import { runRepoCheck as runTool } from "../extensions/repo-check.ts";

function fixture(t: { after: (fn: () => void) => void }) {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runner check ")));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

test("large error reports drain stdout and remain parseable through the wrapper", (t) => {
	const root = fixture(t);
	fs.writeFileSync(path.join(root, "source.ts"), "text\n");
	fs.writeFileSync(path.join(root, "conventions.json"), JSON.stringify({
		version: "v1", conventions: Array.from({ length: 8000 }, (_, index) => ({
			name: `rule-${index}`, paths: "*.ts", must: { contain: ["missing"] },
		})),
	}));
	const result = runTool(root);
	assert.ok(!("error" in result));
	assert.equal(result.summary.errors, 8000);
});

test("malformed operator types fail as config errors instead of character-wise rules", (t) => {
	const root = fixture(t);
	const file = path.join(root, "conventions.json");
	for (const must of [{ haveFiles: "README.md" }, { contain: 3 }, { maxLines: -1 }]) {
		fs.writeFileSync(file, JSON.stringify({ version: "v1", conventions: [{ name: "invalid", paths: "**", must }] }));
		const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/check-repo.mjs", import.meta.url)), "--json"], {
			cwd: root, encoding: "utf8",
		});
		assert.equal(result.status, 2);
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /config.*invalid value/);
	}
});

test("command checks handle make targets, inline code and bun file operands", (t) => {
	const root = fixture(t);
	fs.mkdirSync(path.join(root, "nested"));
	fs.writeFileSync(path.join(root, "nested", "Makefile"), "test:\n\techo ok\n");
	fs.writeFileSync(path.join(root, "script.ts"), "");
	assert.equal(checkCommand("make -C nested VAR=value test", root, root), null);
	assert.equal(checkCommand("make --directory=nested -j 4 test", root, root), null);
	assert.match(checkCommand("make -C nested *", root, root), /no "\*" target/);
	assert.equal(checkCommand('node -e "console.log(1/2)"', root, root), null);
	assert.equal(checkCommand("bun ./script.ts", root, root), null);
	assert.equal(checkCommand("bun script.ts", root, root), null);
	assert.equal(checkCommand("bun build ./script.ts", root, root), null);
	assert.equal(checkCommand(`node "${path.join(root, "script.ts")}"`, root, root), null);
});

test("non-file AGENTS.md yields a warning instead of aborting the audit", (t) => {
	const root = fixture(t);
	fs.mkdirSync(path.join(root, "AGENTS.md"));
	assert.ok(runRepoCheck(root).rows.some((row: { detail: string }) => row.detail.includes("not a regular file")));
});

test("a relative override is resolved against the calling process, not the target repo", (t) => {
	const root = fixture(t);
	const script = path.join(root, "override.mjs");
	const target = path.join(root, "target");
	fs.mkdirSync(target);
	fs.writeFileSync(script, "console.log(JSON.stringify({ root: 'selected override', rows: [], configWarnings: [], summary: {errors: 0,warnings: 0,checkedPaths: 0,conventions: 0} }));");
	const previous = process.env.REPO_CHECK_SCRIPT;
	process.env.REPO_CHECK_SCRIPT = path.relative(process.cwd(), script);
	t.after(() => {
		if (previous === undefined) delete process.env.REPO_CHECK_SCRIPT;
		else process.env.REPO_CHECK_SCRIPT = previous;
	});
	const result = runTool(target);
	assert.ok(!("error" in result));
	assert.equal(result.root, "selected override");
});
