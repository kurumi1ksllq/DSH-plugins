const { createRequire, registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Run with the desktop executable in ELECTRON_RUN_AS_NODE mode.
if (process.platform !== 'win32') throw new Error('This smoke harness exercises Windows WSL and PowerShell; use platform tests on macOS/Linux.');
const distribution = process.env.PTC_WSL_DISTRIBUTION || '';
const root = (process.env.PTC_RUNTIME_MODULES || path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'dsh', 'node_modules')).replaceAll('\\', '/') + '/';
const fromRuntime = createRequire(root + 'package.json');
const stageRoot = path.resolve(__dirname, '..');
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/')) return next(specifier, { ...context, parentURL: pathToFileURL(root + '__integration__.mjs').href });
  if (specifier === 'dsh-deep-ptc-mode' || specifier.startsWith('dsh-deep-ptc-mode/'))
    return next(pathToFileURL(stageRoot + '/lib/' + (specifier.split('/')[1] || 'index') + '.mjs').href, context);
  return next(specifier, context);
} });

(async () => {
  const stage = stageRoot;
  const load = file => import(pathToFileURL(file).href);
  const { Context, Service } = await load(fromRuntime.resolve('@deepseek-ai/cordis'));
  const rootContext = new Context();
  console.log('Context methods:', ['plugin', 'start', 'stop', 'get', 'set', 'provide', 'dispose'].filter(k => typeof rootContext[k] === 'function').join(', '));
  const mod = await load(stage + '/lib/index.mjs');
  console.log('Settings schema:', mod.Config.type, 'valid');
  const mappedExecutor = await load(stage + '/lib/executor.mjs');
  console.log('Executor schema:', mappedExecutor.Config.type, 'valid');
  const waitFor = async (probe, what) => {
    for (let i = 0; i < 100 && !probe(); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(probe(), what);
  };
  const { default: SubprocessLocal } = await load(fromRuntime.resolve('@deepseek-ai/dsh-subprocess-local'));
  class TestPolicy extends Service {
    constructor(ctx) { super(ctx, 'sandboxPolicy'); this.defaultMode = 'danger-full-access'; }
    resolve() { return { mode: 'danger-full-access', workspaceRoot: path.resolve(__dirname) }; }
  }
  class TestSandbox extends Service {
    constructor(ctx) { super(ctx, 'sandbox'); }
    confine() { throw new Error('Unexpected sandbox call in full-access probe'); }
  }
  const fibers = [rootContext.plugin(TestPolicy), rootContext.plugin(TestSandbox), rootContext.plugin(SubprocessLocal, {})];
  for (const fiber of fibers) await fiber;
  // The executor extends the official bash executor named by the base declaration.
  const executorFiber = rootContext.plugin(mappedExecutor, { environment: 'wsl', wslDistribution: distribution,
    base: '@deepseek-ai/dsh-bash-sandbox', options: {} });
  await executorFiber;
  await waitFor(() => rootContext.get('shell'), 'mapped WSL executor service registered');
  const executor = rootContext.get('shell');
  assert.ok(executor, 'executor service registered');
  const spec = executor.resolve({ command: 'printf "PTC_WSL_OK:%s\\n" "$WSL_DISTRO_NAME"', workdir: path.resolve(__dirname) });
  const handle = await executor.execute(spec);
  const result = await handle.result();
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout.text, /PTC_WSL_OK:\S+/);
  console.log('Real WSL command:', result.stdout.text.trim());
  await assert.rejects(executor.execute({ ...spec, sandboxPolicy: { mode: 'read-only', workspaceRoot: spec.workdir } }), /No command was executed/);
  console.log('Confined WSL refusal: passed');
  class TestTools extends Service {
    constructor(ctx) { super(ctx, 'tools'); this.definitions = []; }
    register(definition) { return this.ctx.effect(() => {
      this.definitions.push(definition);
      return () => { this.definitions = this.definitions.filter(d => d !== definition); };
    }); }
    guard(guard) { return this.ctx.effect(() => {
      this.guards = [...(this.guards ?? []), guard];
      return () => { this.guards = this.guards.filter(g => g !== guard); };
    }); }
  }
  class TestPrompt extends Service {
    constructor(ctx) { super(ctx, 'systemPrompt'); }
    section() { return () => {}; }
    getSectionOrder() { return 1010; }
  }
  class TestShellEnv extends Service {
    constructor(ctx) { super(ctx, 'shellEnv'); }
    collect() { return {}; }
  }
  class TestWorkingDirectory extends Service {
    constructor(ctx) { super(ctx, 'workingDirectory'); }
    resolve() { return path.resolve(__dirname); }
  }
  for (const plugin of [TestTools, TestPrompt, TestShellEnv, TestWorkingDirectory]) fibers.push(rootContext.plugin(plugin));
  const { default: Loader, Group } = await load(fromRuntime.resolve('@deepseek-ai/cordis-plugin-loader'));
  const loaderFiber = rootContext.plugin(Loader, { baseUrl: pathToFileURL(stage + '/cordis.patch.yml').href });
  await loaderFiber;
  rootContext.loader.builtins.group = Group;
  rootContext.loader.internal = undefined;
  const model = await load(stage + '/lib/model.mjs');
  const template = JSON.parse(fs.readFileSync(stage + '/lib/preset.json', 'utf8'));
  const powershell = model.configuredPreset(template, { environment: 'powershell', wslDistribution: '' }, 'win32');
  const group = powershell.plugins.find(row => row.id === 'execution');
  console.log('Loading isolated PowerShell group');
  await rootContext.loader.create(group);
  await rootContext.loader.await();
  console.log('Loaded isolated group');
  console.log(JSON.stringify([...rootContext.loader.entries()].map(entry => ({ id: entry.options.id, name: entry.options.name, state: entry.fiber?.state }))));
  assert.equal(rootContext.get('shell').constructor.name, 'MappedShellExecutor', 'root executor must remain untouched by the preset group');
  await waitFor(() => rootContext.tools.definitions.some(definition => definition.name === 'pwsh'), 'pwsh tool registered');
  const pwsh = rootContext.tools.definitions.find(definition => definition.name === 'pwsh');
  assert.ok(pwsh, 'PowerShell tool registered in isolated group');
  const psResult = await pwsh.execute({ command: 'Write-Output ("PTC_PWSH_OK:" + $PSVersionTable.PSEdition)',
    description: 'Verify native PowerShell execution', workdir: path.resolve(__dirname) },
    { signal: new AbortController().signal, callId: 'ptc-runtime-probe' });
  const psText = JSON.stringify(psResult);
  assert.match(psText, /PTC_PWSH_OK/);
  assert.equal(psResult.exitCode, 0);
  console.log('Real isolated PowerShell command: passed');
  console.log('Root shell remains WSL: passed');
  await rootContext.loader.remove(group.id);
  await rootContext.loader.await();
  const { default: JobsLocal } = await load(fromRuntime.resolve('@deepseek-ai/dsh-jobs-local'));
  const jobTools = await load(fromRuntime.resolve('@deepseek-ai/dsh-tool-jobs'));
  fibers.push(rootContext.plugin(JobsLocal, {}));
  fibers.push(rootContext.plugin(jobTools, {}));
  for (const fiber of fibers) await fiber;
  const wslGroup = model.configuredPreset(template, { environment: 'wsl', wslDistribution: distribution }, 'win32').plugins.find(row => row.id === 'execution');
  await rootContext.loader.create(wslGroup);
  await rootContext.loader.await();
  await waitFor(() => rootContext.tools.definitions.some(definition => definition.name === 'bash'), 'bash tool registered');
  const bashTool = rootContext.tools.definitions.find(definition => definition.name === 'bash');
  assert.ok(bashTool, 'WSL Bash tool registered');
  const bashResult = await bashTool.execute({ command: 'printf "PTC_TOOL_WSL_OK:%s\\n" "$PWD"',
    description: 'Verify WSL tool and working directory', workdir: path.resolve(__dirname) },
    { signal: new AbortController().signal, callId: 'ptc-wsl-tool-probe' });
  assert.equal(bashResult.exitCode, 0);
  assert.match(JSON.stringify(bashResult), /PTC_TOOL_WSL_OK:\/mnt\/c\//);
  console.log('Real isolated WSL tool and cwd: passed');
  const job = await bashTool.execute({ command: 'printf "PTC_BACKGROUND_OK\\n"',
    description: 'Verify managed WSL background output', workdir: path.resolve(__dirname), run_in_background: true },
    { signal: new AbortController().signal, callId: 'ptc-background-probe' });
  assert.equal(job.kind, 'background');
  const outputTool = rootContext.tools.definitions.find(definition => definition.name === 'job_output');
  const output = await outputTool.execute({ job_id: job.jobId, wait: true, timeout_ms: 5000 },
    { signal: new AbortController().signal, callId: 'ptc-job-output-probe' });
  assert.equal(output.job.status, 'completed');
  assert.match(output.text, /PTC_BACKGROUND_OK/);
  console.log('Managed WSL background job and output: passed');
  await rootContext.loader.remove(wslGroup.id);
  await rootContext.loader.await();
  const zshGroup = model.configuredPreset(template, { environment: 'zsh', wslDistribution: '' }, 'darwin').plugins.find(row => row.id === 'execution');
  await rootContext.loader.create(zshGroup);
  await rootContext.loader.await();
  await waitFor(() => rootContext.tools.definitions.some(definition => definition.name === 'zsh'), 'zsh tool registered');
  const zshTool = rootContext.tools.definitions.find(definition => definition.name === 'zsh');
  assert.ok(zshTool, 'Native Zsh tool registered');
  assert.match(zshTool.description, /zsh/);
  assert.equal(rootContext.tools.definitions.some(definition => definition.name === 'bash'), false);
  console.log('Zsh tool mount and dialect: passed (no macOS execution on this host)');
  await rootContext.loader.remove(zshGroup.id);
  await rootContext.loader.await();
  const registered = [];
  let nextRegistration;
  class TestPresetRegistry extends Service {
    constructor(ctx) { super(ctx, 'agentPresets'); }
    async register(definition) {
      registered.push(definition);
      nextRegistration?.();
      return async () => {};
    }
  }
  const registryFiber = rootContext.plugin(TestPresetRegistry);
  await registryFiber;
  await rootContext.loader.create({ id: 'deep-ptc-settings', name: 'dsh-deep-ptc-mode', config: { environment: 'wsl', wslDistribution: distribution } });
  await rootContext.loader.await();
  assert.equal(registered.at(-1).plugins.find(row => row.id === 'execution').config[0].config.environment, 'wsl');
  const updated = new Promise(resolve => { nextRegistration = resolve; });
  await rootContext.loader.update('deep-ptc-settings', { id: 'deep-ptc-settings', name: 'dsh-deep-ptc-mode', config: { environment: 'powershell', wslDistribution: 'Ubuntu' } });
  await updated;
  assert.equal(registered.at(-1).plugins.find(row => row.id === 'execution').config[0].name, '@deepseek-ai/dsh-pwsh-sandbox');
  assert.equal(registered[0].plugins.find(row => row.id === 'execution').config[0].config.environment, 'wsl');
  console.log('Real loader volatile settings update and retained definition: passed');
  await rootContext.loader.remove('deep-ptc-settings');
  await rootContext.loader.await();
  await registryFiber.dispose();
  class TestProjections extends Service {
    constructor(ctx) { super(ctx, 'sessionProjections'); }
    register() { return () => {}; }
  }
  const projectionsFiber = rootContext.plugin(TestProjections);
  await projectionsFiber;
  // From 0.2.2 the preset registry also requires the agent registry.
  class TestAgents extends Service {
    constructor(ctx) { super(ctx, 'agents'); }
    get() { return undefined; }
    roots() { return []; }
  }
  const agentsFiber = rootContext.get('agents') === undefined ? rootContext.plugin(TestAgents) : undefined;
  await agentsFiber;
  const { AgentPresetRegistry } = await load(fromRuntime.resolve('@deepseek-ai/dsh-agent-preset-registry'));
  const actualRegistryFiber = rootContext.plugin(AgentPresetRegistry, { default: 'execution-probe' });
  await actualRegistryFiber;
  const full = model.configuredPreset(template, { environment: 'wsl', wslDistribution: distribution }, 'win32').plugins;
  const probeRows = [wslGroup, ...full.filter(row => ['reachability', 'tool-jobs'].includes(row.id))];
  const releaseProbe = await rootContext.agentPresets.register({ id: 'execution-probe', plugins: probeRows });
  const inventory = await rootContext.agentPresets.compositionInventory();
  assert.equal(inventory[0].broken, undefined);
  assert.ok(rootContext.tools.guards?.length > 0, 'reachability guard registered');
  assert.match(rootContext.tools.guards[0]({ name: 'bash', arguments: { command: 'sleep 60' } }) ?? '', /refuses/);
  console.log('Reachability guard and wrapped job tools activate in the preset: passed');
  for (const composition of rootContext.agentPresets.inspectCompositions()) assert.deepEqual(composition.leakedServices, []);
  console.log('Actual preset-registry activation and no service leaks: passed');
  await releaseProbe();
  await actualRegistryFiber.dispose();
  await agentsFiber?.dispose();
  await projectionsFiber.dispose();
  await loaderFiber.dispose();
  console.log('Cordis runtime integration passed');
  for (const fiber of [executorFiber, ...fibers.reverse()]) await fiber.dispose();
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
