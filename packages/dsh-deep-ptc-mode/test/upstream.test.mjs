import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import snapshot from '../lib/preset.json' with { type: 'json' };
import { deriveDeepPtc, personaFrom, PRESET_META, walkRows } from '../lib/model.mjs';
import { loadOfficialPreset, OFFICIAL_PRESET_SPECIFIER, parseOfficialExecutors, parseOfficialPreset, PRESET_PATH_ENV } from '../lib/upstream.mjs';
import { assertDerivation, assertPeerCoverage, requiredPeerPackages } from '../scripts/check.mjs';

const fixtureUrl = name => new URL(`fixtures/${name}`, import.meta.url);
const current = () => parseOfficialPreset(readFileSync(fixtureUrl('ptc-0.2.2-rc.1.patch.yml'), 'utf8'));
const older = () => parseOfficialPreset(readFileSync(fixtureUrl('ptc-0.2.1-rc.3.patch.yml'), 'utf8'));
const derive = (upstream, overrides = {}) => deriveDeepPtc(upstream, { environment: 'wsl', wslDistribution: '', ...overrides }, 'win32');

test('loads the shipped declaration from a file and reports its source', () => {
  const loaded = loadOfficialPreset({ presetPath: fileURLToPath(fixtureUrl('ptc-0.2.2-rc.1.patch.yml')) });
  assert.equal(loaded.preset.id, 'ptc');
  assert.ok(Array.isArray(loaded.preset.plugins) && loaded.preset.plugins.length > 10);
  assert.match(loaded.source, /ptc-0\.2\.2-rc\.1\.patch\.yml$/u);
});

test('honours the diagnostic preset-path override', () => {
  const before = process.env[PRESET_PATH_ENV];
  process.env[PRESET_PATH_ENV] = fileURLToPath(fixtureUrl('ptc-0.2.1-rc.3.patch.yml'));
  try {
    const loaded = loadOfficialPreset();
    assert.equal(loaded.preset.id, 'ptc');
    assert.equal(JSON.stringify(loaded.preset.plugins).includes('list-agents'), true);
  } finally {
    if (before === undefined) delete process.env[PRESET_PATH_ENV];
    else process.env[PRESET_PATH_ENV] = before;
  }
});

test('finds the declaration in any patch layer and preserves loader expressions', () => {
  const text = [
    '- insert:',
    '    - id: unrelated',
    '      name: some-plugin',
    '- insert:',
    '    - id: preset-ptc',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: ptc',
    '        plugins:',
    '          - id: tool-bash',
    "            name: '@deepseek-ai/dsh-tool-bash'",
    '            disabled: !!js process.platform === "win32"',
  ].join('\n');
  const parsed = parseOfficialPreset(text);
  assert.equal(parsed.id, 'ptc');
  assert.deepEqual(parsed.plugins[0].disabled, { __jsExpr: 'process.platform === "win32"' });
});

test('inherits unknown future rows untouched', () => {
  const upstream = structuredClone(current());
  upstream.plugins.push({ id: 'tool-future', name: '@deepseek-ai/dsh-tool-future', config: { mode: 'next' } });
  const { preset } = derive(upstream);
  assert.deepEqual(preset.plugins.find(row => row.id === 'tool-future'), { id: 'tool-future', name: '@deepseek-ai/dsh-tool-future', config: { mode: 'next' } });
  assertDerivation(upstream, preset);
});

test('survives official row reordering', () => {
  const upstream = structuredClone(current());
  const persona = upstream.plugins.shift();
  upstream.plugins.push(persona);
  const { preset } = derive(upstream);
  assert.equal(preset.plugins.filter(row => row.name === '@deepseek-ai/dsh-persona').length, 1);
  assert.equal(preset.plugins.find(row => row.name === '@deepseek-ai/dsh-persona').config.prefix, personaFrom().prefix);
  assertDerivation(upstream, preset);
});

test('tolerates official rows the plugin wraps disappearing', () => {
  const upstream = structuredClone(current());
  upstream.plugins = upstream.plugins.filter(row => !['tool-jobs', 'tool-ask-user'].includes(row.id));
  const { preset, report } = derive(upstream);
  assert.deepEqual(report.wrapped, []);
  assert.equal(report.skipped.length, 2);
  assertDerivation(upstream, preset);
});

test('keeps the official shell rows when the chosen environment cannot be mapped onto them', () => {
  const upstream = structuredClone(current());
  upstream.plugins = upstream.plugins.filter(row => !['tool-bash', 'tool-pwsh'].includes(row.id));
  const { preset, report } = derive(upstream);
  assert.deepEqual(report.replacedShellRows, []);
  assert.equal(report.environment, 'official');
  assert.match(report.skipped.join(' '), /no bash tool row/);
  assert.equal(preset.plugins.some(row => row.id === 'execution'), false);
  assert.ok(preset.plugins.some(row => row.id === 'reachability'), 'the reachability guard still applies');
  assertDerivation(upstream, preset);

  const blocked = derive(current(), { mappedExecutor: false });
  assert.equal(blocked.report.environment, 'official');
  assert.ok(blocked.preset.plugins.some(row => row.id === 'tool-bash' && row.name === '@deepseek-ai/dsh-tool-bash'));
  assertDerivation(current(), blocked.preset, { mappedExecutor: false });
});

test('follows official module renames instead of loading a hard-coded name', () => {
  const upstream = structuredClone(current());
  upstream.plugins.find(row => row.id === 'tool-jobs').name = '@deepseek-ai/dsh-tool-jobs-next';
  upstream.plugins.find(row => row.id === 'tool-bash').name = '@deepseek-ai/dsh-tool-shell';
  const executors = { bash: { name: '@deepseek-ai/dsh-shell-sandbox', config: { graceMs: 5000 } }, pwsh: { name: '@deepseek-ai/dsh-pwsh-sandbox' } };
  const { preset } = derive(upstream, { executors });
  assert.equal(preset.plugins.find(row => row.id === 'tool-jobs').config.upstream, '@deepseek-ai/dsh-tool-jobs-next');
  const [executor, terminal] = preset.plugins.find(row => row.id === 'execution').config;
  assert.equal(terminal.config.upstream, '@deepseek-ai/dsh-tool-shell');
  assert.equal(executor.config.base, '@deepseek-ai/dsh-shell-sandbox');
  assert.deepEqual(executor.config.options, { graceMs: 5000, timeoutMs: 30000, maxTimeoutMs: 30000 });
  assertDerivation(upstream, preset, { executors });
});

test('reads the official executors from the base deployment declaration', () => {
  const executors = parseOfficialExecutors(readFileSync(fixtureUrl('base-0.2.2-rc.1.patch.yml'), 'utf8'));
  assert.deepEqual(executors, {
    bash: { name: '@deepseek-ai/dsh-bash-sandbox', config: { timeoutMs: 60000 } },
    pwsh: { name: '@deepseek-ai/dsh-pwsh-sandbox' },
  });
});

test('rejects unusable declarations instead of publishing a broken preset', () => {
  assert.throws(() => deriveDeepPtc({}, {}, 'win32'), /no plugin rows/);
  assert.throws(() => deriveDeepPtc({ plugins: [] }, {}, 'win32'), /no plugin rows/);
  assert.throws(() => deriveDeepPtc({ plugins: [null] }, {}, 'win32'), /malformed/);
  assert.throws(() => parseOfficialPreset('- insert: []'), /declares no agent preset/);
});

test('the bundled fallback snapshot composes like the pinned declaration', () => {
  assert.deepEqual(derive(snapshot).preset.plugins, derive(current()).preset.plugins);
  assert.equal(derive(snapshot).preset.id, PRESET_META.id);
});

test('platform and environment coverage select the intended executor', () => {
  const cases = [
    ['win32', 'wsl', 'dsh-deep-ptc-mode/executor', 'wsl'],
    ['win32', 'powershell', '@deepseek-ai/dsh-pwsh-sandbox', undefined],
    ['darwin', 'zsh', 'dsh-deep-ptc-mode/executor', 'zsh'],
    ['linux', 'bash', '@deepseek-ai/dsh-bash-sandbox', undefined],
    ['linux', 'auto', '@deepseek-ai/dsh-bash-sandbox', undefined],
  ];
  const upstream = current();
  for (const [platform, environment, name, executionEnvironment] of cases) {
    const { preset } = deriveDeepPtc(upstream, { environment, wslDistribution: '' }, platform);
    const executor = preset.plugins.find(row => row.id === 'execution').config[0];
    assert.equal(executor.name, name, `${platform}/${environment}`);
    assert.equal(executor.config.environment, executionEnvironment, `${platform}/${environment}`);
    const resolved = environment === 'auto' ? (platform === 'win32' ? 'powershell' : 'bash') : environment;
    assertDerivation(upstream, preset, { environment: resolved, platform });
  }
});

test('verifies the installed declaration when pointed at it', () => {
  // Only when the runtime exposes the declaration; the offline fixture is the default.
  try {
    const { preset } = loadOfficialPreset();
    assertDerivation(preset, derive(preset).preset);
    assert.equal(typeof OFFICIAL_PRESET_SPECIFIER, 'string');
  } catch (error) {
    assert.match(error.message, /cannot resolve|ENOENT/u);
  }
});

test('replaces official rows nested inside a group and keeps the execution group with them', () => {
  const upstream = structuredClone(current());
  const movedIds = ['tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-ask-user'];
  const moved = upstream.plugins.filter(row => movedIds.includes(row.id));
  upstream.plugins = upstream.plugins.filter(row => !moved.includes(row));
  upstream.plugins.push({ id: 'future-group', name: 'cordis:group', group: true, config: moved });
  const { preset } = derive(upstream);
  const all = [];
  walkRows(preset.plugins, row => all.push(row));
  const replacements = { 'tool-jobs': 'dsh-deep-ptc-mode/jobs-tool', 'tool-ask-user': 'dsh-deep-ptc-mode/ask-user' };
  for (const row of moved) {
    if (replacements[row.id] !== undefined) {
      assert.equal(all.find(candidate => candidate.id === row.id)?.name, replacements[row.id]);
    } else {
      assert.equal(all.some(candidate => candidate.name === row.name), false, `${row.name} replaced`);
    }
  }
  const group = all.find(row => row.id === 'future-group');
  assert.ok(group, 'official group survives');
  assert.ok(group.config.some(row => row.id === 'execution'), 'execution group inserted where the shell rows were');
  assertDerivation(upstream, preset);
});

test('rejects a declaration that is not the ptc preset', () => {
  const text = [
    '- insert:',
    '    - id: preset-other',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: other',
    '        plugins:',
    '          - id: persona',
    "            name: '@deepseek-ai/dsh-persona'",
    '            config: { prefix: a, suffix: b }',
  ].join('\n');
  assert.throws(() => parseOfficialPreset(text), /declares no agent preset with id "ptc"/);
});

test('every host package the plugin imports is peer-declared', () => {
  const required = requiredPeerPackages();
  assert.ok(required.includes('@deepseek-ai/dsh-web-app'), 'the official declaration package is routed through peers');
  assert.doesNotThrow(() => assertPeerCoverage());
});

test('running-host registry compositions override filesystem assumptions and are reread',async()=>{
 const {loadCurrentPreset}=await import('../lib/upstream.mjs');
 const saved=process.env.DSH_DEEP_PTC_PRESET;delete process.env.DSH_DEEP_PTC_PRESET;
 try {
  let name='runtime_a';const registry={readDocument:async id=>({agentPreset:id,name:'Host PTC',content:`- id: dynamic\n  name: ${name}\n`})};
  assert.equal((await loadCurrentPreset(registry)).preset.plugins[0].name,'runtime_a');
  name='runtime_b';assert.equal((await loadCurrentPreset(registry)).preset.plugins[0].name,'runtime_b');
 }finally{if(saved===undefined)delete process.env.DSH_DEEP_PTC_PRESET;else process.env.DSH_DEEP_PTC_PRESET=saved;}
});
