import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deriveDeepPtc, personaFrom, PRESET_META, SHELL_ROWS, SHELL_TOOLS, walkRows } from '../lib/model.mjs';
import { OFFICIAL_PACKAGE, OFFICIAL_PRESET_ID, parseOfficialPreset } from '../lib/upstream.mjs';

const root = new URL('../', import.meta.url);
export { parseOfficialPreset as parsePreset };

const isPersona = row => row.name === '@deepseek-ai/dsh-persona' || row.id === 'persona';
const isShell = row => SHELL_ROWS.names.includes(row.name) || SHELL_ROWS.ids.includes(row.id);
const isWrapped = row => row.name === '@deepseek-ai/dsh-tool-jobs' || row.id === 'tool-jobs'
  || row.name === '@deepseek-ai/dsh-tool-ask-user' || row.id === 'tool-ask-user';

function flatten(rows) {
  const all = [];
  walkRows(rows, row => all.push(row));
  return all;
}

/**
 * Bare packages referenced by the plugin's host code must be peer dependencies:
 * the host only routes a linked plugin's bare specifier to the installation
 * when the plugin's own manifest declares that name as a peer.
 * @returns Sorted package names referenced under `lib/`.
 */
export function requiredPeerPackages() {
  const packages = new Set([OFFICIAL_PACKAGE]);
  const patterns = [
    /\bfrom\s+['"](@deepseek-ai\/[^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)/gu,
  ];
  for (const name of readdirSync(new URL('lib/', root))) {
    if (!name.endsWith('.mjs')) continue;
    const text = readFileSync(new URL(`lib/${name}`, root), 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const pkg = match[1].split('/').slice(0, 2).join('/');
        if (pkg !== 'dsh-deep-ptc-mode') packages.add(pkg);
      }
    }
  }
  return [...packages].sort();
}

/** Assert every referenced host package is peer-declared, plus the YAML parser dependency. */
export function assertPeerCoverage() {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const peers = new Set(Object.keys(manifest.peerDependencies ?? {}));
  for (const pkg of requiredPeerPackages()) {
    assert.ok(peers.has(pkg), `${pkg} must be listed in peerDependencies so linked installations route it to the host runtime`);
  }
  assert.ok(manifest.dependencies?.['js-yaml'], 'js-yaml is a runtime dependency of the declaration reader');
}

/**
 * Assert that a derived preset is exactly the official composition plus the
 * Deep PTC-owned changes, and nothing else.
 * @param upstream - Parsed official PTC preset.
 * @param preset - Output of deriveDeepPtc.
 * @param options - environment/platform pair used for the derivation.
 */
export function assertDerivation(upstream, preset, { environment = 'wsl', wslDistribution = '', platform = 'win32', foregroundSeconds = 30, ...more } = {}) {
  assert.equal(preset.id, PRESET_META.id);
  assert.equal(preset.name, PRESET_META.name);
  assert.ok(typeof preset.description === 'string' && preset.description.includes('当前环境'));
  assert.ok(Array.isArray(preset.plugins) && preset.plugins.length > 0);

  const derivedRows = flatten(preset.plugins);
  const upstreamRows = flatten(upstream.plugins);
  const ids = derivedRows.filter(row => typeof row.id === 'string').map(row => row.id);
  assert.equal(new Set(ids).size, ids.length, 'preset row ids are unique across the tree');
  const derivedById = new Map(derivedRows.filter(row => typeof row.id === 'string').map(row => [row.id, row]));

  const persona = personaFrom();
  const personas = derivedRows.filter(isPersona);
  assert.equal(personas.length, 1, 'exactly one persona row');
  assert.equal(personas[0].config.prefix, persona.prefix);
  assert.equal(personas[0].config.suffix, persona.suffix);

  // The execution group replaces the official shell rows only when the chosen environment maps onto
  // an official shell tool; otherwise those rows are inherited unchanged.
  const execution = derivedRows.filter(row => row.name === 'cordis:group' && row.isolate?.shell === true);
  const grouped = execution.length > 0;

  // Every official row survives, is replaced on purpose, or is wrapped.
  for (const row of upstreamRows) {
    if (isPersona(row)) continue;
    if (isShell(row) && grouped) {
      // The official row is gone; its module is loaded by Deep PTC's terminal, which reuses the
      // historical ids inside the execution group, so only a top-level id reuse would shadow it.
      assert.equal(derivedRows.some(candidate => candidate.name === row.name), false,
        `official shell row ${row.name} must be replaced`);
      assert.equal(preset.plugins.some(candidate => candidate.id === row.id), false,
        `official shell row ${row.id} must be replaced`);
      continue;
    }
    const candidate = derivedById.get(row.id) ?? derivedRows.find(item => item.name === row.name || item.config?.upstream === row.name);
    assert.ok(candidate, `official row ${row.id ?? row.name} is missing from the derived preset`);
    if (isWrapped(row)) {
      assert.match(candidate.name, /^dsh-deep-ptc-mode\//u);
      assert.equal(candidate.config?.upstream, row.name, `${row.id} loads the official module ${row.name}`);
      const officialConfig = row.config ?? {};
      for (const key of Object.keys(officialConfig)) {
        assert.deepEqual(candidate.config?.options?.[key], officialConfig[key], `${row.id} keeps official config ${key}`);
      }
      continue;
    }
    if (row.group === true) {
      const { config: officialConfig, ...officialRest } = row;
      const { config: derivedConfig, ...derivedRest } = candidate;
      assert.deepEqual(derivedRest, officialRest, `official group ${row.id} keeps its declaration`);
      continue;
    }
    assert.deepEqual(candidate, row, `official row ${row.id} is inherited unchanged`);
  }

  // The Deep PTC additions are present exactly once and carry the expected shape.
  if (grouped) {
    assert.equal(execution.length, 1, 'one isolated execution group');
    const [executor, terminal] = execution[0].config.filter(row => !String(row.id).startsWith('execution'));
    assert.ok(executor && terminal, 'executor and terminal rows');
    const kind = environment === 'powershell' || (environment === 'auto' && platform === 'win32') ? 'pwsh' : 'bash';
    const officialTool = upstreamRows.find(row => SHELL_TOOLS[kind].ids.includes(row.id) || SHELL_TOOLS[kind].names.includes(row.name));
    assert.equal(terminal.config.upstream, officialTool?.name, `terminal loads the official ${kind} tool`);
    assert.doesNotMatch(JSON.stringify(executor), /dsh-tool-/u, 'executor comes from the base declaration');
  }
  const guard = derivedRows.filter(row => row.name === 'dsh-deep-ptc-mode/guard');
  assert.equal(guard.length, 1, 'one reachability guard');
  assert.equal(guard[0].config.foregroundSeconds, foregroundSeconds);
  const compatibility = derivedRows.filter(row => row.name === 'dsh-deep-ptc-mode/tool-compatibility');
  assert.equal(compatibility.length, 1, 'one scoped compatibility observer, no extra capability');
  assert.equal(preset.description.endsWith(`当前环境：${environment}${environment === 'wsl' && wslDistribution ? ` (${wslDistribution})` : ''}`), true);

  // Top-level order among untouched rows is preserved.
  const upstreamOrder = upstream.plugins.filter(row => !isPersona(row) && !isShell(row)).map(row => row.id);
  const derivedOrder = preset.plugins
    .filter(row => row && !isPersona(row) && !String(row.name).startsWith('dsh-deep-ptc-mode/')
      && row.id !== 'execution' && row.id !== 'reachability')
    .map(row => row.id)
    .filter(id => upstreamOrder.includes(id));
  assert.deepEqual(derivedOrder, upstreamOrder.filter(id => derivedOrder.includes(id)));

  // Determinism across repeated derivations.
  const again = deriveDeepPtc(upstream, { environment, wslDistribution, foregroundSeconds, ...more }, platform).preset;
  assert.deepEqual(again, preset, 'derivation is deterministic');
}

/**
 * Verify the checked-in snapshot still derives the same preset as the pinned
 * official declaration, then report the plugin's declared upstream.
 * @param upstreamPath - Optional live declaration to verify instead of the fixture.
 */
export function check(upstreamPath) {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const provenance = JSON.parse(readFileSync(new URL('compatibility.json', root), 'utf8'));
  assertPeerCoverage();
  const fixtureUrl = new URL(`test/fixtures/ptc-${provenance.verifiedUpstream}.patch.yml`, root);
  const file = upstreamPath === undefined ? fixtureUrl : upstreamPath;
  const text = readFileSync(file);
  if (upstreamPath === undefined && provenance.snapshotSha256 !== undefined) {
    assert.equal(createHash('sha256').update(text).digest('hex'), provenance.snapshotSha256, 'pinned fixture matches compatibility.json');
  }
  const upstream = parseOfficialPreset(text.toString('utf8'));
  assert.equal(upstream.id, OFFICIAL_PRESET_ID);
  const template = JSON.parse(readFileSync(new URL('lib/preset.json', root), 'utf8'));
  assert.deepEqual(deriveDeepPtc(template, { environment: 'wsl', wslDistribution: '' }, 'win32').preset,
    deriveDeepPtc(upstream, { environment: 'wsl', wslDistribution: '' }, 'win32').preset,
    'bundled fallback snapshot is in sync with the pinned declaration');

  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const environment of platform === 'win32' ? ['auto', 'wsl', 'powershell'] : ['auto', 'zsh', 'bash']) {
      const { preset, report } = deriveDeepPtc(upstream, { environment, wslDistribution: '' }, platform);
      const resolved = environment === 'auto'
        ? (platform === 'win32' ? 'powershell' : platform === 'darwin' ? 'zsh' : 'bash')
        : environment;
      assertDerivation(upstream, preset, { environment: resolved, platform });
      if (report.replacedShellRows.length === 0) throw new Error('official shell rows were not found; review the declaration');
    }
  }
  return {
    version: manifest.version,
    verifiedUpstream: provenance.verifiedUpstream,
    officialTopLevelRows: upstream.plugins.length,
    personaWords: (personaFrom().prefix + ' ' + personaFrom().suffix).split(/\s+/u).length,
    environmentsChecked: 9,
    peerPackages: requiredPeerPackages().length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--upstream');
  if (flag >= 0 && !process.argv[flag + 1]) throw new Error('Usage: npm run check:upstream -- /path/to/ptc.patch.yml');
  console.log(JSON.stringify(check(flag >= 0 ? process.argv[flag + 1] : undefined), null, 2));
}
