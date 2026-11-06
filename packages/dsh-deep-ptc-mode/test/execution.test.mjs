import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import template from '../lib/preset.json' with { type: 'json' };
import {
  availableEnvironments, assertExecutionPolicy, configuredPreset, deriveDeepPtc, normalizeDistribution,
  PRESET_META, resolveEnvironment, shellArgv, SHELL_ROWS,
} from '../lib/model.mjs';
import { presetLifecycle } from '../lib/lifecycle.mjs';
import { assertDerivation, check } from '../scripts/check.mjs';
import { loadOfficialPreset, parseOfficialPreset } from '../lib/upstream.mjs';

test('auto selects the host native shell without guessing the existing root provider', () => {
  assert.equal(resolveEnvironment('auto', 'win32'), 'powershell');
  assert.equal(resolveEnvironment('auto', 'darwin'), 'zsh');
  assert.equal(resolveEnvironment('auto', 'linux'), 'bash');
  assert.throws(() => resolveEnvironment('wsl', 'darwin'), /unavailable/);
  assert.throws(() => resolveEnvironment('bash', 'win32'), /unavailable/);
  assert.throws(() => resolveEnvironment('unknown', 'win32'), /unavailable/);
});

test('WSL keeps command text and host cwd as distinct argv, including spaces and quotes', () => {
  const spec = { workdir: 'C:\\project with spaces\\中文', command: 'printf "%s\\n" "$HOME"; echo \'hello\'' };
  assert.deepEqual(shellArgv('wsl', spec, ' Ubuntu ', 'win32'),
    ['wsl.exe', '--distribution', 'Ubuntu', '--cd', spec.workdir, '--exec', 'bash', '-lc', spec.command]);
  assert.deepEqual(shellArgv('wsl', spec, '', 'win32').slice(0, 2), ['wsl.exe', '--cd']);
  assert.throws(() => normalizeDistribution('Ubuntu\nother'), /control/);
  assert.throws(() => normalizeDistribution(' --exec'), /dash/);
});

test('WSL fails before execution in confined or missing policies', () => {
  assertExecutionPolicy('wsl', { mode: 'danger-full-access' });
  for (const mode of ['read-only', 'workspace-write', 'unknown'])
    assert.throws(() => assertExecutionPolicy('wsl', { mode }), /No command was executed/);
  assert.throws(() => assertExecutionPolicy('wsl'), /No command was executed/);
  assert.doesNotThrow(() => assertExecutionPolicy('zsh', { mode: 'workspace-write' }));
});

test('macOS Zsh uses an explicit native binary and preserves source literally', () => {
  const spec = { command: 'print -r -- "$ZSH_VERSION"', workdir: '/tmp/project' };
  assert.deepEqual(shellArgv('zsh', spec, '', 'darwin'), ['/bin/zsh', '-lc', spec.command]);
  assert.deepEqual(shellArgv('zsh', spec, '', 'linux'), ['zsh', '-lc', spec.command]);
});

test('environment selection isolates executors and leaves every other official tool intact', () => {
  const before = structuredClone(template);
  const upstream = loadOfficialPreset({ presetPath: new URL('fixtures/ptc-0.2.2-rc.1.patch.yml', import.meta.url) }).preset;
  for (const platform of ['win32', 'darwin', 'linux']) for (const environment of availableEnvironments(platform)) {
    const preset = configuredPreset(upstream, { environment, wslDistribution: 'Ubuntu' }, platform);
    const group = preset.plugins.find(row => row.id === 'execution');
    assert.deepEqual(group.isolate, { shell: true });
    assert.equal(group.config.filter(row => row.id.startsWith('tool-')).length, 1);
    if (resolveEnvironment(environment, platform) === 'powershell')
      assert.equal(group.config[0].name, '@deepseek-ai/dsh-pwsh-sandbox');
    assert.equal(preset.plugins.some(row => SHELL_ROWS.ids.includes(row.id)), false, 'official shell rows replaced');
  }
  assert.deepEqual(template, before);
});

test('official composition changes are inherited instead of tripping a drift gate', () => {
  const upstream = parseOfficialPreset(readFileSync(new URL('fixtures/ptc-0.2.2-rc.1.patch.yml', import.meta.url), 'utf8'));
  const { preset, report } = deriveDeepPtc(upstream, { environment: 'wsl', wslDistribution: '' }, 'win32');
  assertDerivation(upstream, preset, { environment: 'wsl' });
  assert.equal(JSON.stringify(preset.plugins).includes('dsh-tool-subagent-control/list-agents'), false);
  assert.ok(preset.plugins.some(row => row.name === '@deepseek-ai/dsh-tool-executor-ptc'), 'new official executor inherited');
  assert.deepEqual(report.replacedShellRows.sort(), ['tool-bash (@deepseek-ai/dsh-tool-bash)', 'tool-pwsh (@deepseek-ai/dsh-tool-pwsh)']);
  assert.deepEqual(report.wrapped.sort(), ['tool-ask-user (@deepseek-ai/dsh-tool-ask-user)', 'tool-jobs (@deepseek-ai/dsh-tool-jobs)']);

  const changed = structuredClone(upstream);
  changed.plugins.find(row => row.id === 'tool-web').config.fetch = false;
  changed.plugins.push({ id: 'tool-future', name: '@deepseek-ai/dsh-tool-future' });
  const drifted = deriveDeepPtc(changed, { environment: 'wsl', wslDistribution: '' }, 'win32').preset;
  assert.equal(drifted.plugins.find(row => row.id === 'tool-web').config.fetch, false);
  assert.ok(drifted.plugins.some(row => row.id === 'tool-future'));
  assertDerivation(changed, drifted, { environment: 'wsl' });
});

test('registry updates serialize and retain captured per-session definitions', async () => {
  const live = new Map();
  const retired = [];
  let environment = 'wsl';
  const lifecycle = presetLifecycle(async definition => {
    assert.equal(live.has(definition.id), false);
    live.set(definition.id, definition);
    return async () => { retired.push(definition); live.delete(definition.id); };
  }, () => configuredPreset(template, { environment, wslDistribution: 'Ubuntu' }, 'win32'), () => {});
  await lifecycle.refresh();
  const existingSessionDefinition = live.get('deep-ptc');
  environment = 'powershell';
  await Promise.all([lifecycle.refresh(), lifecycle.refresh()]);
  assert.equal(live.get('deep-ptc').plugins.find(row => row.id === 'execution').config[0].name,
    '@deepseek-ai/dsh-pwsh-sandbox');
  assert.equal(existingSessionDefinition.plugins.find(row => row.id === 'execution').config[0].config.environment, 'wsl');
  assert.ok(retired.includes(existingSessionDefinition));
  environment = 'invalid';
  await assert.rejects(lifecycle.refresh(), /unavailable/);
  assert.ok(live.has('deep-ptc'));
  await lifecycle.dispose();
  assert.equal(live.size, 0);
});

test('teardown during asynchronous registration releases the late definition exactly once', async () => {
  let complete;
  let markStarted;
  let releases = 0;
  const started = new Promise(resolve => { complete = resolve; });
  const registrationStarted = new Promise(resolve => { markStarted = resolve; });
  const lifecycle = presetLifecycle(() => { markStarted(); return started; }, () => ({ id: PRESET_META.id }), () => {});
  const refresh = lifecycle.refresh();
  await registrationStarted;
  const disposal = lifecycle.dispose();
  complete(async () => { releases++; });
  await Promise.all([refresh, disposal]);
  assert.equal(releases, 1);
});

test('package and verified fixture checks pass', () => {
  assert.equal(check().version, '1.7.3');
});
