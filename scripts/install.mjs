#!/usr/bin/env node
// Install / uninstall the dsh-websearch-failover DSH bundle into a DSH profile.
//
//   node scripts/install.mjs --dry-run        print every planned action, write nothing
//   node scripts/install.mjs                  build plugin/lib, copy the bundle, wire the profile
//   node scripts/install.mjs --uninstall      remove the bundle, the bundles entry and the patch block
//
//   --profile <dir>   target profile (default: $DSH_PROFILE_DIR, then
//                     $DSH_HOME/profiles/desktop, then ~/.dsh/profiles/desktop)
//   --source <dir>    checkout to install from (default: this repository)
//   --no-build        trust an existing plugin/lib/ instead of running the build
//
// The profile is edited in exactly two places:
//   1. package.json  -> "dsh-websearch-failover" appended to dsh.profile.bundles
//   2. cordis.patch.yml -> one marked block: the `web` row's searchProvider override
//                         plus the `insert` row that mounts this bundle.
// Both edits are idempotent, back up once per change and can be removed byte-for-byte
// by --uninstall. Nothing else in the profile is touched, and the runtime state under
// $DSH_HOME/websearch-failover/ is never read or written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const BUNDLE = 'dsh-websearch-failover';
/** Provider id the harness selects through `web.searchProvider`. */
const PROVIDER_ID = 'websearch-failover';
const MARK_START = '# >>> websearch-failover (managed by scripts/install.mjs — re-run to update, --uninstall to remove)';
const MARK_END = '# <<< websearch-failover';

/** Files the bundle cannot work without. */
const REQUIRED_PLUGIN_FILES = ['package.json', 'cordis.patch.yml', 'index.js'];
/** Generated engine copies, produced by scripts/build-plugin.mjs. */
const REQUIRED_LIB_FILES = ['core.mjs', 'http.mjs', 'runtime.mjs', 'balance.mjs', 'api.mjs'];
/** Never copied into the profile: dev-only trees and generated throwaways. */
const SKIP_NAMES = new Set(['node_modules', '.git', '.DS_Store', 'test']);
/** Legacy prototype artifacts at the plugin root; the bundle uses plugin/lib/. */
const SKIP_ROOT_FILES = new Set(['install.mjs', 'core.mjs']);
const SKIP_PATTERN = /\.bak-|\.log$/;

const MODE_INSTALL = 'install';
const MODE_UNINSTALL = 'uninstall';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const options = {
    mode: MODE_INSTALL,
    dryRun: false,
    build: true,
    profile: undefined,
    source: REPO,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      index += 1;
      return value;
    };
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--uninstall') options.mode = MODE_UNINSTALL;
    else if (arg === '--no-build') options.build = false;
    else if (arg === '--profile') options.profile = path.resolve(take());
    else if (arg === '--source') options.source = path.resolve(take());
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/install.mjs [--dry-run] [--uninstall] [--profile <dir>] [--source <dir>] [--no-build]');
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.dryRun && options.mode === MODE_UNINSTALL) {
    // Allowed: --dry-run --uninstall is the "what would a rollback do" view.
  }
  return options;
}

// ---------------------------------------------------------------- text output

function say(line = '') {
  console.log(line);
}

function fail(message) {
  const error = new Error(message);
  error.userFacing = true;
  throw error;
}

// ---------------------------------------------------------------- profile

function resolveProfile(explicit) {
  const candidates = [];
  if (explicit !== undefined) candidates.push({ dir: explicit, origin: '--profile' });
  else if (process.env.DSH_PROFILE_DIR) candidates.push({ dir: path.resolve(process.env.DSH_PROFILE_DIR), origin: '$DSH_PROFILE_DIR' });
  else {
    const home = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), '.dsh');
    candidates.push({ dir: path.join(home, 'profiles', 'desktop'), origin: 'DSH_HOME' });
    const fallback = path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
    if (path.resolve(fallback) !== path.resolve(candidates[0].dir)) candidates.push({ dir: fallback, origin: '~/.dsh' });
  }
  const missing = [];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate.dir, 'package.json'))) return candidate;
    missing.push(`${candidate.dir} (from ${candidate.origin})`);
  }
  if (explicit !== undefined || process.env.DSH_PROFILE_DIR) {
    fail(`profile has no package.json: ${missing.join(', ')} — point --profile at a DSH profile directory`);
  }
  fail(`no DSH profile with a package.json found; checked ${missing.join(', ')} — pass --profile <dir>`);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function uniqueBackupPath(file) {
  const base = `${file}.bak-websearch-failover-${stamp()}`;
  let candidate = base;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

// ---------------------------------------------------------------- JSON manifest editing

/**
 * Locate the `dsh.profile.bundles` array in the raw manifest text without
 * reformatting the file: the whole plugin relies on byte-for-byte round trips.
 * @returns {{ open: number, close: number }} indexes of `[` and `]`
 */
function bundlesSpan(text) {
  const keyAt = text.indexOf('"bundles"');
  if (keyAt === -1) fail('profile package.json has no dsh.profile.bundles list — add it or install through the DSH plugin manager');
  const open = text.indexOf('[', keyAt);
  if (open === -1) fail('profile package.json: dsh.profile.bundles is not an array');
  let depth = 0;
  let inString = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return { open, close: index };
    }
  }
  fail('profile package.json: unterminated dsh.profile.bundles array');
}

function readBundles(text) {
  const { open, close } = bundlesSpan(text);
  return JSON.parse(text.slice(open, close + 1));
}

/** @returns {{ text: string, changed: boolean }} */
function addBundleEntry(text) {
  const bundles = readBundles(text);
  if (bundles.includes(BUNDLE)) return { text, changed: false };
  const { open, close } = bundlesSpan(text);
  const inner = text.slice(open + 1, close);
  const entry = JSON.stringify(BUNDLE);
  const multiline = inner.includes('\n');
  let replacement;
  if (inner.trim() === '') {
    replacement = multiline ? `\n${indentUnit(text)}${indentUnit(text)}${entry}\n${indentUnit(text)}` : entry;
  } else if (multiline) {
    const elementIndent = inner.match(/\n([ \t]+)(?=")/)?.[1] ?? `${indentUnit(text)}${indentUnit(text)}`;
    // Keep the closing-bracket whitespace (`\n      `) byte-identical: append the
    // separator and the new element *before* it.
    const tail = inner.match(/\s*$/)[0];
    const body = inner.slice(0, inner.length - tail.length);
    replacement = `${body},\n${elementIndent}${entry}${tail}`;
  } else {
    replacement = `${inner.replace(/\s+$/, '')}, ${entry}`;
  }
  const next = `${text.slice(0, open + 1)}${replacement}${text.slice(close)}`;
  const parsed = JSON.parse(next);
  if (!parsed.dsh?.profile?.bundles?.includes(BUNDLE)) fail('internal: failed to add the bundles entry');
  return { text: next, changed: true };
}

function indentUnit(text) {
  const firstIndent = text.match(/\n([ \t]+)"/)?.[1];
  return firstIndent ?? '  ';
}

/** @returns {{ text: string, changed: boolean }} */
function removeBundleEntry(text) {
  const bundles = readBundles(text);
  if (!bundles.includes(BUNDLE)) return { text, changed: false };
  const { open, close } = bundlesSpan(text);
  const entry = JSON.stringify(BUNDLE);
  const inner = text.slice(open + 1, close);
  let replacement;
  if (new RegExp(`,\\s*${escapeRegex(entry)}`).test(inner)) {
    replacement = inner.replace(new RegExp(`,\\s*${escapeRegex(entry)}`), '');
  } else if (new RegExp(`${escapeRegex(entry)}\\s*,`).test(inner)) {
    replacement = inner.replace(new RegExp(`${escapeRegex(entry)}\\s*,`), '');
  } else {
    replacement = inner.replace(entry, '');
  }
  const next = `${text.slice(0, open + 1)}${replacement}${text.slice(close)}`;
  let parsed;
  try {
    parsed = JSON.parse(next);
  } catch (error) {
    fail(`refusing to write a broken profile package.json (${error.message}); restore it from the backup and retry`);
  }
  if (parsed.dsh?.profile?.bundles?.includes(BUNDLE)) fail('internal: failed to remove the bundles entry');
  return { text: next, changed: true };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- patch block

function patchBlock() {
  return [
    MARK_START,
    '# A profile patch replaces the whole `config` of the row it targets, so',
    '# fetchProvider is restated to keep the stock http fetcher selected.',
    '- id: web',
    '  config:',
    `    searchProvider: ${PROVIDER_ID}`,
    '    fetchProvider: http',
    '- insert:',
    `    - id: ${PROVIDER_ID}`,
    `      name: '${BUNDLE}'`,
    MARK_END,
    '',
  ].join('\n');
}

function blockRegion(text) {
  const start = text.indexOf(MARK_START);
  if (start === -1) return undefined;
  const endMarker = text.indexOf(MARK_END, start);
  if (endMarker === -1) fail(`found "${MARK_START}" without "${MARK_END}" in the profile patch; repair the file by hand first`);
  let regionStart = start;
  // Swallow the blank separator line the installer inserts before the block.
  if (text.slice(0, start).endsWith('\n\n')) regionStart = start - 1;
  return { start: regionStart, end: endMarker + MARK_END.length };
}

/** @returns {{ text: string, changed: boolean }} */
function upsertPatchBlock(text) {
  const block = patchBlock();
  const region = blockRegion(text);
  if (region !== undefined) {
    const current = text.slice(region.start, region.end);
    const desired = text.slice(0, region.start) === '' ? block : `\n${block}`;
    if (current === desired.replace(/\n$/, '') || current === desired) return { text, changed: false };
    const next = `${text.slice(0, region.start)}${desired.replace(/\n$/, '')}${text.slice(region.end)}`;
    return { text: ensureTrailingNewline(next), changed: true };
  }
  const base = text.length === 0 ? '' : ensureTrailingNewline(text);
  const next = base.length === 0 ? block : `${base}\n${block}`;
  return { text: ensureTrailingNewline(next), changed: true };
}

/** @returns {{ text: string, changed: boolean }} */
function stripPatchBlock(text) {
  const region = blockRegion(text);
  if (region === undefined) return { text, changed: false };
  const head = text.slice(0, region.start);
  const tail = text.slice(region.end).replace(/^\r?\n/, '');
  return { text: ensureTrailingNewline(`${head}${tail}`), changed: true };
}

function ensureTrailingNewline(text) {
  if (text.length === 0) return text;
  return text.endsWith('\n') ? text : `${text}\n`;
}

// ---------------------------------------------------------------- build + copy

function runBuild(sourceRoot) {
  const script = path.join(sourceRoot, 'scripts', 'build-plugin.mjs');
  if (!fs.existsSync(script)) {
    fail(`build script missing: ${script}; install from a full checkout or pass --source <dir>`);
  }
  const result = spawnSync(process.execPath, [script, '--root', sourceRoot], { cwd: sourceRoot, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, output };
}

function checkBuild(sourceRoot) {
  const script = path.join(sourceRoot, 'scripts', 'build-plugin.mjs');
  if (!fs.existsSync(script)) return { state: 'missing', detail: `build script missing: ${script}` };
  const result = spawnSync(process.execPath, [script, '--root', sourceRoot, '--check'], { cwd: sourceRoot, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0) return { state: 'clean', detail: output };
  const missing = output.match(/missing engine sources/);
  return { state: missing ? 'missing-sources' : 'stale', detail: output };
}

function collectPluginFiles(sourceRoot, options) {
  const pluginDir = path.join(sourceRoot, 'plugin');
  if (!fs.existsSync(pluginDir)) fail(`bundle source missing: ${pluginDir}`);
  for (const file of REQUIRED_PLUGIN_FILES) {
    if (!fs.existsSync(path.join(pluginDir, file))) fail(`bundle source is incomplete: missing plugin/${file}`);
  }
  if (options.mode === MODE_INSTALL && options.build === false) {
    for (const file of REQUIRED_LIB_FILES) {
      if (!fs.existsSync(path.join(pluginDir, 'lib', file))) {
        fail(`plugin/lib/${file} is missing — run \`node scripts/build-plugin.mjs\` (or drop --no-build)`);
      }
    }
  }
  const files = new Map();
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (SKIP_NAMES.has(entry.name) || SKIP_PATTERN.test(entry.name)) continue;
      if (prefix === '' && SKIP_ROOT_FILES.has(entry.name)) continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) files.set(rel, fs.readFileSync(full));
    }
  };
  walk(pluginDir, '');
  if (files.size === 0) fail(`bundle source is empty: ${pluginDir}`);
  return files;
}

/** @returns {{ same: boolean, extra: string[] }} */
function compareTree(targetDir, files) {
  if (!fs.existsSync(targetDir)) return { same: false, extra: [] };
  const existing = new Map();
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else existing.set(rel, fs.readFileSync(full));
    }
  };
  walk(targetDir, '');
  const extra = [...existing.keys()].filter((rel) => !files.has(rel));
  const same =
    extra.length === 0 &&
    existing.size === files.size &&
    [...files.entries()].every(([rel, content]) => existing.get(rel)?.equals(content));
  return { same, extra: extra.sort() };
}

function copyTree(targetDir, files) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const to = path.join(targetDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, content);
  }
}

// ---------------------------------------------------------------- plan

function plan({ options, profile, sourceRoot, targetDir, manifestPath, patchPath }) {
  const actions = [];
  const install = options.mode === MODE_INSTALL;
  const text = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

  if (install) {
    const files = collectPluginFiles(sourceRoot, options);
    const diff = compareTree(targetDir, files);
    if (!diff.same) {
      const note = diff.extra.length > 0 ? `, remove ${diff.extra.length} stale file(s)` : '';
      actions.push({ kind: 'copy', text: `copy plugin/ (${files.size} files) -> ${targetDir}${note}`, files });
    }
    const manifest = addBundleEntry(text(manifestPath));
    if (manifest.changed) actions.push({ kind: 'manifest', text: `add "${BUNDLE}" to dsh.profile.bundles`, next: manifest.text, file: manifestPath });
    const patch = upsertPatchBlock(text(patchPath));
    if (patch.changed) actions.push({ kind: 'patch', text: `write the managed websearch-failover block to ${patchPath}`, next: patch.text, file: patchPath });
  } else {
    if (fs.existsSync(targetDir)) actions.push({ kind: 'copy', text: `remove ${targetDir}` });
    const manifest = removeBundleEntry(text(manifestPath));
    if (manifest.changed) actions.push({ kind: 'manifest', text: `remove "${BUNDLE}" from dsh.profile.bundles`, next: manifest.text, file: manifestPath });
    const patch = stripPatchBlock(text(patchPath));
    if (patch.changed) actions.push({ kind: 'patch', text: `remove the managed websearch-failover block from ${patchPath}`, next: patch.text, file: patchPath });
  }
  return actions;
}

// ---------------------------------------------------------------- main

function main() {
  const options = parseArgs(process.argv.slice(2));
  const resolved = resolveProfile(options.profile);
  const profile = resolved.dir;
  const sourceRoot = options.source;
  const targetDir = path.join(profile, 'node_modules', BUNDLE);
  const manifestPath = path.join(profile, 'package.json');
  const patchPath = path.join(profile, 'cordis.patch.yml');
  const install = options.mode === MODE_INSTALL;

  say('dsh-websearch-failover installer');
  say(`  mode      : ${install ? 'install' : 'uninstall'}${options.dryRun ? ' (dry-run)' : ''}`);
  say(`  source    : ${sourceRoot}`);
  say(`  profile   : ${profile} (from ${resolved.origin})`);
  say(`  package   : ${targetDir}`);
  say(`  manifest  : ${manifestPath}`);
  say(`  patch     : ${patchPath}`);

  if (install && options.build) {
    if (options.dryRun) {
      const check = checkBuild(sourceRoot);
      say(`  build     : ${check.state}${check.detail ? ` — ${firstLine(check.detail)}` : ''}`);
    } else {
      const built = runBuild(sourceRoot);
      if (!built.ok) {
        say(`  build     : FAILED`);
        for (const line of built.output.split('\n')) say(`    ${line}`);
        fail('build failed — fix lib/ (or plugin/lib/), then re-run. Nothing was installed.');
      }
      say(`  build     : ok — ${firstLine(built.output.split('\n').reverse().find((line) => line.includes('plugin/lib')) ?? 'plugin/lib ready')}`);
    }
  } else if (install) {
    say('  build     : skipped (--no-build)');
  }
  say('');

  const actions = plan({ options, profile, sourceRoot, targetDir, manifestPath, patchPath });
  if (actions.length === 0) {
    say(install ? 'unchanged: profile already up to date' : 'unchanged: nothing installed, nothing to remove');
    say(install ? 'next: restart the DSH desktop app (or reload the page) if the bundle is not mounted yet.' : '');
    return;
  }

  say(options.dryRun ? 'planned actions (dry-run: nothing written):' : 'actions:');
  let backupPlan = false;
  for (const action of actions) {
    const prefix = options.dryRun ? '  would ' : '  ';
    say(`${prefix}${describe(action)}`);
    if (action.next !== undefined) backupPlan = true;
  }
  if (backupPlan) say(`  ${options.dryRun ? 'would write' : 'will write'} timestamped .bak-websearch-failover-* backups next to each edited file`);

  if (options.dryRun) {
    say('');
    say('dry-run: nothing written');
    return;
  }

  if (install && options.build) {
    // Refresh the file map now that the build produced plugin/lib.
  }
  for (const action of actions) {
    if (action.kind === 'copy' && action.files !== undefined) {
      copyTree(targetDir, action.files);
    } else if (action.kind === 'copy') {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } else {
      fs.copyFileSync(action.file, uniqueBackupPath(action.file));
      fs.writeFileSync(action.file, action.next, 'utf8');
    }
  }

  say('');
  say(`result: ${actions.length} change(s) applied`);
  if (install) {
    say('');
    say('next steps:');
    say('  1. restart the DSH desktop app (or reload the page) so the host row and the client bundle load');
    say(`  2. confirm the left sidebar shows the web-search provider manager`);
    say(`  3. config: ${path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'websearch-failover', 'providers.json')}`);
    say('  4. roll back with: node scripts/install.mjs --uninstall');
  } else {
    say('');
    say('next steps:');
    say('  1. restart the DSH desktop app so web.searchProvider falls back to the bundled provider');
    say('  2. runtime state under ~/.dsh/websearch-failover/ was left untouched');
  }
}

function describe(action) {
  if (action.kind === 'build') return `build: ${action.text}`;
  if (action.kind === 'copy') return `package: ${action.text}`;
  if (action.kind === 'manifest') return `manifest: ${action.text}`;
  if (action.kind === 'patch') return `patch: ${action.text}`;
  return action.text;
}

function firstLine(text) {
  return String(text ?? '').split('\n').filter((line) => line.trim() !== '')[0] ?? '';
}

try {
  main();
} catch (error) {
  console.error(`install: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
