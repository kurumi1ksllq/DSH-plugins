// A missing optional dependency must switch off tool discovery and quarantine, never the preset. Mounts
// through the real preset registry and loader; a host without the module or service is simulated.
//   PTC_RUNTIME_MODULES=/path/to/dsh/node_modules node scripts/check-degrade.cjs
const { createRequire, registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const path = require('node:path');

const modules = process.env.PTC_RUNTIME_MODULES;
if (!modules) throw new Error('Set PTC_RUNTIME_MODULES to the runtime node_modules directory');
const stage = path.resolve(__dirname, '..');
const from = createRequire(path.join(modules, 'package.json'));
const parentURL = pathToFileURL(path.join(modules, '__degrade__.mjs')).href;
const unavailable = new Set();
registerHooks({ resolve(specifier, context, next) {
  if (unavailable.has(specifier)) throw Object.assign(new Error(`Cannot find package '${specifier}'`), { code: 'ERR_MODULE_NOT_FOUND' });
  if (specifier.startsWith('@deepseek-ai/')) return next(specifier, { ...context, parentURL });
  if (specifier.startsWith('dsh-deep-ptc-mode/'))
    return next(pathToFileURL(path.join(stage, 'lib', `${specifier.split('/')[1]}.mjs`)).href, context);
  return next(specifier, context);
} });
const load = name => import(pathToFileURL(from.resolve(name)).href);

async function scenario(label, { withCommands = true, breakSession = false }) {
  const { Context, Service } = await load('@deepseek-ai/cordis');
  const { default: Prompt } = await load('@deepseek-ai/dsh-system-prompt');
  const { ToolRuntime, defineTool } = await load('@deepseek-ai/dsh-tools');
  const { default: Loader, Group } = await load('@deepseek-ai/cordis-plugin-loader');
  const { AgentPresetRegistry } = await load('@deepseek-ai/dsh-agent-preset-registry');
  const root = new Context();
  class Agents extends Service { constructor(ctx) { super(ctx, 'agents'); } get() { return undefined; } roots() { return []; } }
  class Projections extends Service { constructor(ctx) { super(ctx, 'sessionProjections'); } register() { return { dispose() {}, stateOf() {} }; } }
  await root.plugin(Prompt, {});
  await root.plugin(ToolRuntime, {});
  await root.plugin(Agents);
  await root.plugin(Projections);
  if (withCommands) await root.plugin((await load('@deepseek-ai/dsh-commands')).default);
  await root.plugin(Loader, { baseUrl: pathToFileURL(path.join(stage, 'cordis.patch.yml')).href });
  root.loader.builtins.group = Group;
  root.loader.internal = undefined;
  await root.plugin(AgentPresetRegistry, { default: 'probe' });
  if (breakSession) unavailable.add('@deepseek-ai/dsh-session');
  const release = await root.agentPresets.register({ id: 'probe', plugins: [
    { id: 'tool-compatibility', name: 'dsh-deep-ptc-mode/tool-compatibility', config: { enabled: true } },
  ] });
  const inventory = await root.agentPresets.compositionInventory();
  unavailable.clear();
  assert.equal(inventory[0].broken, undefined, `${label}: the preset must stay usable, got: ${inventory[0].broken}`);
  console.log(`ok  ${label}: preset usable`);
  await release();
  root.registry.values?.();
}

(async () => {
  await scenario('session module missing', { breakSession: true });
  await scenario('commands service missing', { withCommands: false });
  await scenario('everything present', {});
  process.exit(0);
})().catch(error => { console.error(`FAILED  ${error.message}`); process.exit(1); });
