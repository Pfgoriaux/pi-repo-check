/** Structural conventions used by the repository hygiene runner. */
import fs from "node:fs";
import path from "node:path";

const SKIPPED_DIRS = new Set([".git", "node_modules"]);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const OPERATORS = {
  maxLines: (value) => Number.isInteger(value) && value >= 0,
  contain: strings,
  notContain: strings,
  fileNameMatches: (value) => typeof value === "string",
  haveType: (value) => ["file", "directory"].includes(value),
  haveFiles: strings,
};

export class ConfigError extends Error {}

function validateRules(rules, label) {
  if (rules === undefined) return;
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new ConfigError(`${label}: expected an object`);
  for (const [operator, value] of Object.entries(rules)) {
    if (!Object.hasOwn(OPERATORS, operator)) throw new ConfigError(`${label}: unknown operator ${operator}`);
    if (!OPERATORS[operator](value)) throw new ConfigError(`${label}: invalid value for ${operator}`);
  }
}

/** `.git`-respecting walk: yields relative posix paths (files AND directories). */
export function walk(root, { skip = SKIPPED_DIRS } = {}) {
  const out = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue; // unreadable — let the caller see an empty match, not a crash
    }
    for (const e of entries) {
      if (e.isDirectory() && skip.has(e.name)) continue;
      const child = rel === "" ? e.name : `${rel}/${e.name}`;
      out.push(child);
      if (e.isDirectory()) stack.push(child);
    }
  }
  out.sort();
  return out;
}

/**
 * Brace expansion: `prefix.{a,b}` → ["prefix.a", "prefix.b"], non-nested,
 * recursive. No braces → single-element array.
 */
export function expandBraces(pattern) {
  const start = pattern.indexOf("{");
  if (start === -1) return [pattern];
  const end = pattern.indexOf("}", start);
  if (end === -1) return [pattern];
  const inner = pattern.slice(start + 1, end);
  if (inner.includes("{")) return [pattern]; // nesting unsupported — pass through
  return inner
    .split(",")
    .flatMap((alt) => expandBraces(`${pattern.slice(0, start)}${alt}${pattern.slice(end + 1)}`));
}

/**
 * glob → RegExp, spec semantics: single `*` matches exactly one path
 * segment, double-star crosses segments (including zero of them), so a
 * glob like src-dir double-star slash dot-ts matches both top-level and
 * nested files under src-dir.
 */
export function globToRegExp(glob) {
  const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const segs = String(glob).split("/");
  let re = "^";
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    if (seg === "**") {
      re += last ? ".*" : "(?:[^/]+/)*";
    } else {
      re += escape(seg).replaceAll("*", "[^/]*") + (last ? "" : "/");
    }
  });
  return new RegExp(`${re}$`);
}

/** Line count, `wc -l` semantics (trailing newline does not add a line). */
export function countLines(content) {
  if (content === "") return 0;
  const parts = content.split("\n");
  return parts.at(-1) === "" ? parts.length - 1 : parts.length;
}

export function loadConventions(root, file) {
  const abs = file ? path.resolve(file) : path.join(root, "conventions.json");
  if (!fs.existsSync(abs)) return null; // lazy layer: absence is not an error
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    throw new ConfigError(`${abs}: invalid JSON (${err.message})`);
  }
  if (!parsed || typeof parsed !== "object") throw new ConfigError(`${abs}: expected an object`);
  if (parsed.version !== "v1") {
    throw new ConfigError(`${abs}: unsupported version ${JSON.stringify(parsed.version)} (want "v1")`);
  }
  if (!Array.isArray(parsed.conventions)) {
    throw new ConfigError(`${abs}: "conventions" must be an array`);
  }
  for (const [i, conv] of parsed.conventions.entries()) {
    const label = `${abs}: conventions[${i}]`;
    if (!conv || typeof conv.name !== "string" || conv.name === "") {
      throw new ConfigError(`${label}: "name" is required`);
    }
    if (typeof conv.paths !== "string" && !strings(conv.paths)) throw new ConfigError(`${label}: "paths" must be a string or string array`);
    if (conv.only != null && typeof conv.only !== "string" && !strings(conv.only)) throw new ConfigError(`${label}: invalid "only" scope`);
    validateRules(conv.must, `${label}.must`);
    validateRules(conv.mustNot, `${label}.mustNot`);
    if (conv.severity != null && !["error", "warning"].includes(conv.severity)) {
      throw new ConfigError(`${label}: severity must be "error" or "warning"`);
    }
  }
  return parsed.conventions;
}

function matchRegex(pattern, source, convName) {
  try {
    return new RegExp(pattern, "m").test(source);
  } catch (err) {
    throw new ConfigError(`${convName}: invalid regex ${JSON.stringify(pattern)} (${err.message})`);
  }
}

/** Evaluate one convention against one path. Returns rows (possibly empty). */
function checkPath(conv, root, rel) {
  const rows = [];
  const severity = conv.severity ?? "error";
  const abs = path.join(root, rel);
  let stats = null;
  try {
    stats = fs.statSync(abs);
  } catch {
    return [{ conv, rel, severity, detail: "stat failed" }];
  }
  const fail = (detail) => rows.push({ conv, rel, severity, detail });
  const isFile = stats.isFile();
  const must = conv.must ?? {};
  const mustNot = conv.mustNot ?? {};

  if (must.haveType != null && (isFile ? "file" : "directory") !== must.haveType) {
    fail(`is not ${must.haveType}`);
  }
  if (!isFile && !stats.isDirectory()) {
    fail("not a regular file or directory");
    return rows;
  }

  const filesToCheck = must.haveFiles ?? mustNot.haveFiles ?? [];
  if (!isFile && filesToCheck.length > 0) {
    if (must.haveFiles != null) {
      for (const f of must.haveFiles) {
        if (!fs.existsSync(path.join(abs, f))) fail(`missing required sibling ${f}`);
      }
    }
    if (mustNot.haveFiles != null) {
      for (const f of mustNot.haveFiles) {
        if (fs.existsSync(path.join(abs, f))) fail(`forbidden sibling ${f} exists`);
      }
    }
  }

  // Content operators only apply to files. Polarity lives in the operator
  // name: `contain` = every regex must match, `notContain` = none may. The
  // must/mustNot grouping is honored for both keys so hand-written files
  // read naturally regardless of grouping.
  if (!isFile) return rows;
  const content = fs.readFileSync(abs, "utf8");
  if (must.maxLines != null && countLines(content) > must.maxLines) {
    fail(`${countLines(content)} lines > ${must.maxLines}`);
  }
  const mustMatch = must.contain ?? [];
  const mustNotMatch = [...(mustNot.contain ?? []), ...(must.notContain ?? []), ...(mustNot.notContain ?? [])];
  for (const rx of mustMatch) {
    if (!matchRegex(rx, content, conv.name)) fail(`must contain /${rx}/`);
  }
  for (const rx of mustNotMatch) {
    if (matchRegex(rx, content, conv.name)) fail(`must not contain /${rx}/`);
  }
  if (must.fileNameMatches != null) {
    const base = path.basename(rel);
    try {
      if (!new RegExp(must.fileNameMatches).test(base)) fail(`basename "${base}" does not match /${must.fileNameMatches}/`);
    } catch (err) {
      throw new ConfigError(`${conv.name}: invalid fileNameMatches regex (${err.message})`);
    }
  }
  return rows;
}

/**
 * Run all conventions against `root`. Returns
 * { rows, configWarnings, summary } — see the format spec for reporting
 * semantics; callers decide what to do with severities.
 */
export function runCheck(root, { conventionsFile, files, paths } = {}) {
  const conventions = loadConventions(root, conventionsFile);
  if (conventions === null) {
    return {
      rows: [],
      configWarnings: [],
      summary: {
        checkedPaths: 0,
        conventions: 0,
        errors: 0,
        warnings: 0,
        noConventionsFile: true,
      },
    };
  }
  const allPaths = paths ?? walk(root);
  const filter = files ? new Set(files.map((f) => f.replace(/^\.\//, ""))) : null;
  const onlyOf = (conv) => {
    const prefixes = conv.only == null ? [] : Array.isArray(conv.only) ? conv.only : [conv.only];
    return prefixes.map((p) => p.replace(/\/+$/, ""));
  };
  const rows = [];
  const configWarnings = [];
  let touched = new Set();

  for (const conv of conventions) {
    const globs = (Array.isArray(conv.paths) ? conv.paths : [conv.paths]).flatMap(expandBraces);
    const only = onlyOf(conv);
    const regexes = globs.map(globToRegExp);
    // `only` scopes the convention: the glob is evaluated against the path
    // relative to the prefix (files must live under it), so one file can hold
    // the same rule shape for docs rules vs src rules.
    const matched = allPaths.filter((p) => {
      if (filter && !filter.has(p)) return false; // --files: check only asked-for paths
      const scopes = only.length > 0 ? only.map((o) => (p.startsWith(`${o}/`) ? p.slice(o.length + 1) : null)) : [p];
      return scopes.some((scope) => scope != null && regexes.some((re) => re.test(scope)));
    });
    if (matched.length === 0) {
      configWarnings.push(`rule "${conv.name}" matches no paths (dead rule?)`);
      continue;
    }
    touched = new Set([...touched, ...matched]);
    for (const rel of matched) rows.push(...checkPath(conv, root, rel));
  }

  const errors = rows.filter((r) => r.severity === "error").length;
  const warnings = rows.filter((r) => r.severity === "warning").length;
  return {
    rows,
    configWarnings,
    summary: {
      checkedPaths: touched.size,
      conventions: conventions.length,
      errors,
      warnings,
    },
  };
}
