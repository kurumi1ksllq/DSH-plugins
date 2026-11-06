// Live-runtime smoke check for the derived preset.
//
// Run it with the desktop executable in ELECTRON_RUN_AS_NODE mode, exactly like
// the other host checks:
//
//   set ELECTRON_RUN_AS_NODE=1
//   "DeepSeek Harness.exe" <plugin>/scripts/check-preset.cjs [--environment wsl]
//
// It reads the PTC declaration the installed Harness ships, derives the Deep
// PTC preset with the real plugin code, and resolves every row through the
// installed module graph. A row the host no longer resolves fails the check,
// which is what a frozen snapshot would have hidden.
const { createRequire, registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeModules = (process.env.PTC_RUNTIME_MODULES
  || path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'dsh', 'node_modules')).replaceAll('\\', '/') + '/';
const stage = path.resolve(__dirname, '..');
const fromRuntime = createRequire(runtimeModules + 'package.json');
const runtimeBase = pathToFileURL(runtimeModules + '__preset_probe__.mjs').href;

registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'js-yaml' || specifier.startsWith('@deepseek-ai/')) {
    return next(specifier, { ...context, parentURL: runtimeBase });
  }
  if (specifier === 'dsh-deep-ptc-mode' || specifier.startsWith('dsh-deep-ptc-mode/')) {
    const name = specifier.split('/')[1] || 'index';
    return next(pathToFileURL(path.join(stage, 'lib', `${name}.mjs`)).href, context);
  }
  return next(specifier, context);
} });

const load = file => import(pathToFileURL(file).href);

function resolveRows(rows, unresolved, resolved) {
  for (const row of rows) {
    if (row.group === true) { resolveRows(row.config, unresolved, resolved); continue; }
    if (typeof row.name !== 'string') continue;
    // Deep PTC rows load the official module their config names (`upstream`, or `base` for the
    // mapped executor); those official names must resolve like any inherited row.
    const names = row.name.startsWith('dsh-deep-ptc-mode/')
      ? [row.config?.upstream, row.config?.base].filter(name => typeof name === 'string')
      : row.name.startsWith('cordis:') ? [] : [row.name];
    for (const name of names) {
      try {
        fromRuntime.resolve(name);
        resolved.push(name);
      } catch (error) {
        unresolved.push(`${row.id ?? '?'} (${name}): ${error.code ?? error.message}`);
      }
    }
  }
}

(async () => {
  const environmentIndex = process.argv.indexOf('--environment');
  const environment = environmentIndex >= 0 ? process.argv[environmentIndex + 1] : 'wsl';
  const { loadOfficialPreset } = await load(path.join(stage, 'lib', 'upstream.mjs'));
  const model = await load(path.join(stage, 'lib', 'model.mjs'));

  const official = loadOfficialPreset();
  const { BASE_DECLARATION_SPECIFIER, parseOfficialExecutors } = await load(path.join(stage, 'lib', 'upstream.mjs'));
  const executors = parseOfficialExecutors(require('node:fs').readFileSync(fromRuntime.resolve(BASE_DECLARATION_SPECIFIER), 'utf8'));
  assert.ok(executors.bash && executors.pwsh, 'the base declaration names both shell executors');
  const derived = model.deriveDeepPtc(official.preset,
    { environment, wslDistribution: process.env.PTC_WSL_DISTRIBUTION || '', executors }, 'win32');
  const fallback = model.deriveDeepPtc(
    JSON.parse(require('node:fs').readFileSync(path.join(stage, 'lib', 'preset.json'), 'utf8')),
    { environment, wslDistribution: process.env.PTC_WSL_DISTRIBUTION || '' }, 'win32');

  assert.equal(derived.preset.id, 'deep-ptc');
  assert.ok(derived.preset.plugins.length >= official.preset.plugins.length - 1,
    'derived preset keeps the official rows');
  assert.equal(JSON.stringify(derived.preset.plugins).includes('dsh-tool-subagent-control/list-agents'), false,
    'no removed official module remains');

  const unresolved = [];
  const resolved = [];
  resolveRows(derived.preset.plugins, unresolved, resolved);
  resolveRows(fallback.preset.plugins, unresolved, resolved);
  assert.deepEqual(unresolved, [], 'every derived row resolves in the installed runtime');

  console.log(JSON.stringify({
    source: official.source,
    runtimeModules,
    officialRows: official.preset.plugins.length,
    derivedRows: derived.preset.plugins.length,
    fallbackRows: fallback.preset.plugins.length,
    executors,
    report: derived.report,
    resolvedModules: [...new Set(resolved)].sort(),
  }, null, 2));
  console.log('Derived preset row resolution: passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
