// issue-236: a foreground tool (ralph is one) runs its whole loop inside ONE
// run_code program, so the program's ceiling is the batch length. That ceiling is
// the ptc-runtime row's config, declared by @deepseek-ai/dsh-base with NO config,
// so the runtime's loader defaults (120s default / 600s cap) apply.
//
// Two layers, deliberately:
//   1. the patch says what it wants (parsed with js-yaml, not scanned as text);
//   2. the host's own patch layer is fed the real base declaration plus this
//      package's file, because a bare-id patch that finds no row is SKIPPED with a
//      log line rather than failing — the override would silently stop applying
//      and every text assertion would stay green (the #161 failure mode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reachabilityText } from '../lib/rules.mjs';
import { BASE_DECLARATION_SPECIFIER } from '../lib/upstream.mjs';
import { resolveHost } from '../lib/host.mjs';
import { skipUnlessModules } from './support/prerequisites.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATCH = readFileSync(join(HERE, '..', 'cordis.patch.yml'), 'utf8');
const RUNTIME = process.env.DSH_RUNTIME ?? '/opt/dsh-runtime/dshcli/lib/node_modules/@deepseek-ai/dsh/node_modules';
const RUNTIME_PRESENT = existsSync(join(RUNTIME, '@deepseek-ai/cordis-plugin-include'));
const RUNTIME_EXPLICIT = process.env.DSH_RUNTIME !== undefined;

const yamlSkip = skipUnlessModules(['js-yaml']);
const testOrSkip = (title, fn) => (yamlSkip === undefined ? test(title, fn) : test(title, { skip: yamlSkip }, () => {}));

/** The entry for one row id, at any nesting depth of a patch list. */
function findEntry(node, id) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findEntry(child, id);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node === null || typeof node !== 'object') return undefined;
  if (node.id === id) return node;
  for (const value of Object.values(node)) {
    const found = findEntry(value, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

const parsePatch = async () => (await import('js-yaml')).load(PATCH);

/** Resolve the host's patch layer plus a YAML parser, or null. */
async function loadHost() {
  const candidates = [
    { include: '@deepseek-ai/cordis-plugin-include', yaml: 'yaml' },
    {
      include: join(RUNTIME, '@deepseek-ai/cordis-plugin-include/lib/index.js'),
      yaml: join(RUNTIME, 'yaml/dist/index.js'),
    },
    {
      include: join(RUNTIME, '@deepseek-ai/cordis-plugin-include/lib/index.js'),
      yaml: join(RUNTIME, 'js-yaml/index.js'),
    },
  ];
  for (const candidate of candidates) {
    try {
      const [include, yaml] = await Promise.all([import(candidate.include), import(candidate.yaml)]);
      const apply = include.applyEntryPatches;
      if (typeof apply !== 'function') continue;
      // js-yaml exposes `load`, the `yaml` package exposes `parse`; accept either
      // so the guard does not depend on which one this install happens to carry.
      const load = yaml.load ?? yaml.parse ?? yaml.default?.load ?? yaml.default?.parse;
      if (typeof load !== 'function') continue;
      return { apply, load };
    } catch {
      continue;
    }
  }
  return null;
}

testOrSkip('#236 the bundle raises the ptc-runtime ceiling instead of inheriting the 600s default', async () => {
  const row = findEntry(await parsePatch(), 'ptc-runtime');
  assert.ok(row !== undefined, 'the bundle must patch the ptc-runtime row');
  assert.equal(typeof row.config?.maxTimeoutMs, 'number', 'the ceiling must be stated');
  assert.ok(row.config.maxTimeoutMs > 600_000, 'the ceiling must exceed the host default of 600s, got ' + row.config.maxTimeoutMs);
  // The DEFAULT stays at the host value on purpose: a program's deadline is also
  // its uninterruptible window (steering is read at step boundaries; the deep-ptc
  // guard makes job_output / ask_user_question steerable but cannot interrupt a
  // running program), so raising it would stretch every ordinary program's
  // blackout from 2 to 10 minutes. Long work opts in with an explicit timeoutMs.
  assert.equal(row.config.timeoutMs, undefined, 'the default budget must stay at the host value');
});

/** The installed base declaration: whatever the package resolves, else the install tree. */
function baseDeclarationPath() {
  const resolved = resolveHost(BASE_DECLARATION_SPECIFIER);
  if (resolved !== undefined) return fileURLToPath(resolved);
  const inTree = join(RUNTIME, '@deepseek-ai/dsh-base/cordis.patch.yml');
  return existsSync(inTree) ? inTree : undefined;
}

test('#236 the host patch layer really applies the override to the installed base tree', async (t) => {
  const host = await loadHost();
  const basePath = baseDeclarationPath();
  if (host === null || basePath === undefined) {
    if (RUNTIME_PRESENT || RUNTIME_EXPLICIT) {
      assert.fail('the host runtime is configured (' + RUNTIME + ') but its patch layer did not resolve — the guard would be silently dead');
    }
    t.skip('no host runtime in this checkout');
    return;
  }
  // The base declaration is itself a patch list: compose it onto an empty tree
  // first, then apply this bundle's file on top — that is the order the profile
  // loader uses, and the order in which a missing row would be skipped.
  const warnings = [];
  const collect = (format, ...args) => warnings.push(format + ' ' + args.join(' '));
  const baseTree = host.apply([], host.load(readFileSync(basePath, 'utf8')), collect);
  const tree = host.apply(baseTree, host.load(PATCH), collect);
  const row = findEntry(tree, 'ptc-runtime');
  assert.ok(row !== undefined, 'the composed tree must still declare ptc-runtime');
  assert.ok(row.config?.maxTimeoutMs > 600_000, 'the override must survive composition, got ' + JSON.stringify(row.config));
  assert.equal(row.config.timeoutMs, undefined, 'composition must not invent a default');
  assert.deepEqual(warnings.filter((line) => line.includes('not found')), [],
    'a skipped patch would leave the override silently unapplied: ' + warnings.join(' | '));
});

testOrSkip('#236 the reachability text tells the model it may ask for a longer budget, and to batch', async () => {
  const text = reachabilityText({ foregroundSeconds: 30, maxQuestionSeconds: 300, maxPollsPerProgram: 3 });
  assert.match(text, /run_code program has a hard deadline/i);
  assert.match(text, /ralph/i, 'the rule must name the foreground loop it applies to');
  // Raising the cap is only useful if the model knows the knob exists; without
  // this sentence the new ceiling is unreachable in practice.
  assert.match(text, /timeoutMs/, 'the rule must name the knob that reaches the cap');
  assert.match(text, /batch/i);
  assert.match(text, /round-01\.md/, 'the handoff file naming must be concrete');
  // The concrete program budget lives in cordis.patch.yml and the tool schema, not
  // here. Scoped to the deadline sentence: the other rules legitimately state their
  // own configured seconds (foreground wait, pause ceiling, question timeout).
  const deadlineLine = text.split('\n').find((line) => /run_code program has a hard deadline/i.test(line)) ?? '';
  // `round-01.md` is a filename, not a duration: strip the handoff shapes first.
  const withoutNames = deadlineLine.replace(/round-\d+\.md/g, 'HANDOFF');
  assert.doesNotMatch(withoutNames, /\d+\s*(s|sec|secs|seconds|分钟|minutes)|\d{4,}/,
    'the deadline sentence must not restate a configured duration');
});
