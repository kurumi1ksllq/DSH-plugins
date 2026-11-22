import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompatibilityState, classifyToolOutcome, failOpen, markOfficialTool, isOfficialTool, installToolCompatibility, normalizePreferences, QUARANTINE_STRIKES } from '../lib/tool-policy.mjs';
import { toolDirectory, toolNamesInSource } from '../lib/official-names.mjs';
import { blankState, foldToolState, STATE_EVENT, searchCatalog } from '../lib/tool-catalog.mjs';
import { deriveDeepPtc } from '../lib/model.mjs';
import snapshot from '../lib/preset.json' with { type: 'json' };
// A failure that clearly says the provider itself is unavailable.
const broken = { isError: true, error: { code: 'WORKER_UNAVAILABLE' } };
const def = (name, description = name) => ({ name, description, deepPtc: {provider:'test-plugin'}, parameters: { type: 'object' }, output: { schema: {} } });
function setup() {
  const official = markOfficialTool(def('read', 'Read files'), 'installed official module');
  const extension = { ...def('better_read', 'Read files quickly'), deepPtc: { provider: 'example-plugin' } };
  const live = new Map([[official.name, official], [extension.name, extension]]);
  const tools = { get: (name, agent, admitted) => !admitted || admitted.has(name) ? live.get(name) : undefined,
    definitions: (agent, admitted) => [...live.values()].filter(d => !admitted || admitted.has(d.name)) };
  const session = {}, agent = { session }, logs = [];
  let durable = blankState();
  const storage = { read: s => s === session ? durable : blankState(), write: (s, state) => { assert.equal(s, session); logs.push(state); durable = state; } };
  const state = createCompatibilityState(tools, [], storage);
  const call = (name = extension.name) => { const exec = { name, agent }; state.dispatched(exec); return exec; };
  return { state, tools, agent, session, live, official, extension, call, storage, logs };
}
test('an unavailable extension is blocked for this conversation until an explicit reset', () => {
  const f = setup(), exec = f.call();
  f.state.observe(exec, broken);
  assert.match(f.state.guard(f.call()), /quarantined/);
  assert.equal(f.state.guard({ name: 'better_read', agent: { session: {} } }), undefined);
  assert.equal(f.state.guard(f.call('read')), undefined);
  f.state.observe(exec, { isError: false, value: 'late success' });
  assert.match(f.state.guard(f.call()), /quarantined/);
  assert.match(f.state.text({ scope: f.agent }), /no retries or diagnosis/);
  assert.match(f.state.text({ scope: f.agent }), /example-plugin/);
  assert.equal(f.state.reset(f.agent), 1);
  assert.equal(f.state.guard(f.call()), undefined);
});
test('provenance is captured before a reload and no new provider is blamed for an old call', () => {
  const f = setup(), exec = f.call();
  f.live.set('better_read', { ...def('better_read'), deepPtc: { provider: 'new-plugin' } });
  f.state.observe(exec, broken);
  assert.equal(f.state.status(f.agent).blocked[0].provider, 'example-plugin');
  assert.match(f.state.guard(f.call()), /quarantined/); // Only the user's reset lifts the logical-name block.
});
test('late failure after user reset cannot recreate a quarantine mark', () => {
  const f = setup(), old = f.call();
  f.state.reset(f.agent);
  f.state.observe(old, broken);
  assert.equal(f.state.status(f.agent).blocked.length, 0);
});
test('session state survives agent recreation and plugin recreation, without probing', () => {
  const f = setup();
  f.state.observe(f.call(), broken);
  const restored = createCompatibilityState(f.tools, [], f.storage);
  assert.match(restored.guard({ name: 'better_read', agent: { session: f.session } }), /quarantined/);
  assert.equal(f.logs.length, 1);
});
test('no eviction silently re-enables a previously failed tool', () => {
  const f = setup();
  for (let i = 0; i < 24; i++) { const name = `external_${i}`; f.live.set(name, def(name)); f.state.observe(f.call(name), broken); }
  assert.equal(f.state.status(f.agent).blocked.length, 24);
  assert.match(f.state.guard(f.call('external_0')), /quarantined/);
  assert.ok(f.state.text({ scope: f.agent }).length < 1800, 'model-facing failure list is bounded');
});
test('denials, cancellation, task exit codes, empty results and background jobs do not quarantine', () => {
  const f = setup();
  for (const result of [{ isError: true, error: { code: 'PERMISSION_DENIED' } }, { isError: true, error: { code: 'INVALID_ARGUMENTS' } }, { isError: true, error: { code: 'TOOL_ABORTED' } },
    { value: { kind: 'foreground', exitCode: 1 } }, { value: { results: [] } }, { value: { status: 'partial', continuation: 'page-2' } }, { value: { kind: 'background' } }, { value: { kind: 'promoted' } }])
    f.state.observe(f.call(), result);
  f.state.observe({ name: 'better_read', agent: f.agent }, { isError: true }); // Never dispatched: guard/policy.
  assert.equal(f.state.status(f.agent).blocked.length, 0);
});
test('partial failure is quarantined, with task-state readback guidance and no diagnosis', () => {
  const f = setup();
  f.state.observe(f.call(), { value: { status: 'partial', failure: { effectState: 'partial' } } });
  assert.match(f.state.guard(f.call()), /quarantined/);
  assert.match(f.state.text({ scope: f.agent }), /necessary task state/);
});
test('official tool failures stay under the official contract', () => {
  const f = setup(); f.state.observe(f.call('read'), { isError: true });
  assert.equal(f.state.guard(f.call('read')), undefined);
  assert.equal(f.state.status(f.agent).blocked.length, 0);
});
test('search merges all layers into one ranked result, each row annotated with layer and provider', () => {
  const f = setup();
  const plain = { ...def('plain_reader', 'Read files plainly') };
  delete plain.deepPtc;
  f.live.set('plain_reader', plain);
  const result = f.state.search(f.agent, { query: 'read' });
  const rows = Object.fromEntries(result.results.map(r => [r.name, r]));
  assert.deepEqual(result.results.map(r => r.name).sort(), ['better_read', 'plain_reader', 'read']);
  assert.equal(rows.better_read.layer, 'external');
  assert.equal(rows.better_read.provider, 'example-plugin');
  assert.equal(rows.read.layer, 'official');
  assert.equal(rows.read.provider, 'installed official module');
  assert.equal(rows.plain_reader.layer, 'unattributed');
  assert.equal(rows.plain_reader.provider, 'unknown plugin');
  // A quarantined row disappears, but the remaining layers stay visible in the same result set.
  f.state.observe(f.call(), broken);
  const after = f.state.search(f.agent, { query: 'read' });
  assert.ok(!after.results.some(r => r.name === 'better_read'));
  assert.equal(after.total, 2);
  assert.equal(f.state.search(f.agent, { query: 'read' }, new Set()).total, 0);
});
test('schemas are disclosed only after selection; unavailable capabilities never become callable', () => {
  const f = setup();
  assert.deepEqual(f.state.sdkDefinitions(f.agent).map(d => d.name), ['read']);
  const loaded = f.state.load(f.agent, ['better_read']);
  assert.equal(loaded.loaded[0].name, 'better_read');
  assert.deepEqual(f.state.sdkDefinitions(f.agent).map(d => d.name), ['read', 'better_read']);
  f.state.reset(f.agent);
  assert.deepEqual(f.state.sdkDefinitions(f.agent).map(d => d.name), ['read']);
  assert.equal(f.state.load(f.agent, ['better_read'], new Set(['read'])).loaded.length, 0);
  f.live.set('huge', def('huge', 'x'.repeat(20000)));
  assert.equal(f.state.load(f.agent, ['huge']).loaded.length, 0, 'never truncate an executable schema');
  assert.ok(f.state.sdkDefinitions(f.agent).some(def=>def.name==='huge'), 'oversized schema is selected for full SDK disclosure');
});
test('local directory pagination is deterministic and descriptions are bounded', () => {
  const rows = Array.from({ length: 25 }, (_, i) => def(`file_${String(i).padStart(2, '0')}`, 'File search '+ 'x'.repeat(400)));
  const first = searchCatalog(rows, 'file', 0, 6), second = searchCatalog(rows, 'file', first.nextOffset, 6);
  assert.equal(first.results.length, 6); assert.equal(new Set([...first.results, ...second.results].map(r => r.name)).size, 12);
  assert.equal(first.results[0].description.length, 240);
});
test('persistent projection reports failures after the turn and clears on reset', () => {
  const saved = { ...blankState(), blocked: [{ name: 'bad', provider: 'p', kind: 'failure' }] };
  let state = foldToolState(blankState(), { type: STATE_EVENT, ignorable: true, data: saved });
  state = foldToolState(state, { type: 'turn/end', data: { turn: 4 } });
  assert.equal(state.report.tools[0].name, 'bad'); assert.equal(state.report.turn, 4);
  state = foldToolState(state, { type: STATE_EVENT, ignorable: true, data: { ...blankState(), epoch: 1 } });
  assert.equal(state.report, null);
});
test('official declarations remain the source of provenance after arbitrary module renaming', () => {
  const upstream = structuredClone(snapshot);
  upstream.plugins.find(row => row.id === 'tool-fs').name = '@vendor/renamed-file-provider';
  const derived = deriveDeepPtc(upstream, { environment: 'wsl' }, 'win32').preset;
  assert.equal(derived.plugins.find(row => row.id === 'tool-fs').name, '@vendor/renamed-file-provider');
  assert.ok(derived.plugins.find(row => row.id === 'tool-compatibility').config.officialModules.some(row => row.name === '@vendor/renamed-file-provider'));
  assert.equal(derived.plugins.find(row => row.id === 'tool-executor-ptc').name, '@deepseek-ai/dsh-tool-executor-ptc');
});
test('runtime hooks never replay, and block a second call before body dispatch', () => {
  const f = setup(), events = new Map(), guards = [];
  const ctx = { tools: { ...f.tools, guard: g => guards.push(g) }, systemPrompt: { section() {}, context() {} },
    on: (name, fn) => events.set(name, fn), effect() {} };
  installToolCompatibility(ctx);
  const exec = { name: 'better_read', agent: f.agent };
  let count = 0;
  events.get('tools/execute')(exec, () => ++count);
  events.get('tools/result')(exec, broken);
  assert.match(guards[0]({ ...exec }), /quarantined/);
  events.get('tools/execute')({ ...exec }, () => ++count);
  assert.equal(count, 1);
});
test('explicit route names remain validated without an execution alias', () => {
  assert.throws(() => normalizePreferences([{ preferred: 'run_code', fallback: ['read'] }]));
  assert.equal(classifyToolOutcome({}, { value: { status: 'failed', failure: { code: 'WORKER_UNAVAILABLE' } } }).kind, 'unavailable');
  assert.ok(isOfficialTool(markOfficialTool(def('new_official_tool'), 'new module')));
});

test('wrong input never quarantines, however often it repeats', () => {
  const f = setup();
  for (const message of ['ENOENT: no such file: /tmp/typo.txt', 'file not found', 'invalid path', '404 Not Found', 'Permission denied', '403 Forbidden'])
    for (let i = 0; i < QUARANTINE_STRIKES + 1; i++) f.state.observe(f.call(), { isError: true, error: { message } });
  assert.equal(f.state.status(f.agent).blocked.length, 0);
  assert.equal(f.state.guard(f.call()), undefined);
});

test('temporary and unexplained failures need consecutive strikes, and a success clears them', () => {
  const f = setup();
  const timeout = { isError: true, error: { message: 'fetch failed: ETIMEDOUT' } };
  const unexplained = { isError: true, error: { message: 'boom' } };
  for (const failed of [timeout, { isError: true, error: { message: '429 Too Many Requests' } }, unexplained, { isError: true }]) {
    for (let i = 0; i < QUARANTINE_STRIKES - 1; i++) f.state.observe(f.call(), failed);
    assert.equal(f.state.guard(f.call()), undefined, 'still callable below the limit');
    f.state.observe(f.call(), { value: 'worked' });
  }
  assert.equal(f.state.status(f.agent).blocked.length, 0);
  for (let i = 0; i < QUARANTINE_STRIKES; i++) f.state.observe(f.call(), timeout);
  assert.match(f.state.guard(f.call()), /quarantined/);
  assert.equal(f.state.status(f.agent).blocked[0].kind, 'temporary');
  f.state.reset(f.agent);
  f.state.observe(f.call(), timeout);
  assert.equal(f.state.status(f.agent).blocked.length, 0, 'reset also clears the count');
});

test('a broken provider is recognised from a plain error and quarantined at once', () => {
  const f = setup();
  f.state.observe(f.call(), { isError: true, error: { message: 'client.fetch is not a function' } });
  assert.match(f.state.guard(f.call()), /quarantined/);
  const g = setup();
  g.state.observe(g.call(), { isError: true, error: { message: "Cannot find module 'left-pad'" } });
  assert.equal(g.state.status(g.agent).blocked[0].kind, 'unavailable', 'a missing module is not a missing file');
});

test('a normal result reporting on its own subject is not a tool failure', () => {
  for (const value of [{ status: 'failed', build: 42 }, { status: 'error', failures: 3 }, { status: 'unavailable', service: 'redis' }, { status: 'partial' }])
    assert.equal(classifyToolOutcome({}, { value }), undefined);
  const f = setup();
  f.state.observe(f.call(), { value: { status: 'failed', build: 42 } });
  assert.equal(f.state.status(f.agent).blocked.length, 0);
});

test('a name no plugin provides is not recorded as a failed plugin', () => {
  const f = setup();
  f.state.observe(f.call('tool_that_does_not_exist'), { isError: true, error: { code: 'UNKNOWN_TOOL' } });
  assert.equal(f.state.status(f.agent).blocked.length, 0);
});

test('official tools outside the preset stay visible and are never quarantined', () => {
  const f = setup();
  const rootOfficial = def('working_directory', 'Change directory');
  delete rootOfficial.deepPtc;
  f.live.set(rootOfficial.name, rootOfficial);
  const state = createCompatibilityState(f.tools, [], f.storage, { isOfficial: name => name === 'working_directory' });
  assert.ok(state.sdkDefinitions(f.agent).some(d => d.name === 'working_directory'));
  const exec = { name: 'working_directory', agent: f.agent };
  state.dispatched(exec);
  state.observe(exec, broken);
  assert.equal(state.guard({ name: 'working_directory', agent: f.agent }), undefined);
  assert.equal(state.status(f.agent).blocked.length, 0);
  const merged = state.search(f.agent, { query: 'directory' });
  assert.equal(merged.results[0]?.name, 'working_directory');
  assert.equal(merged.results[0]?.layer, 'official');
  assert.ok(!state.sdkDefinitions(f.agent).some(d => d.name === 'better_read'), 'a real extension stays on demand');
});

test('a bundle declaring dsh.toolNames is attributed without reading its source', () => {
  const sources = { 'third-party-plugin': 'defineTool({ name: "scraped_tool" })' };
  const manifests = { 'third-party-plugin': { dsh: { toolNames: ['role_search', 'delegate_role'] } } };
  const entries = [{ options: { name: 'third-party-plugin' } }];
  const directory = toolDirectory(() => ({ entries: () => entries }), {
    readSource: moduleName => { if (!(moduleName in sources)) throw new Error('unreadable'); return sources[moduleName]; },
    readManifest: moduleName => { if (!(moduleName in manifests)) throw new Error('unreadable'); return manifests[moduleName]; },
  });
  assert.equal(directory.isOfficial('role_search'), false);
  assert.equal(directory.providerOf('role_search'), 'third-party-plugin');
  assert.equal(directory.providerOf('delegate_role'), 'third-party-plugin');
  assert.equal(directory.isExternal('role_search'), true);
  assert.equal(directory.providerOf('scraped_tool'), 'third-party-plugin', 'scraped names keep working alongside declared ones');
});

test('an official bundle declaration is official, and invalid declarations are ignored', () => {
  const manifests = { '@deepseek-ai/dsh-tool-x': { dsh: { toolNames: ['declared_official', 42, null, 'declared_official'] } }, 'broken-bundle': 'not-an-object' };
  const entries = [{ options: { name: '@deepseek-ai/dsh-tool-x' } }, { options: { name: 'broken-bundle' } }];
  const directory = toolDirectory(() => ({ entries: () => entries }), {
    readSource: () => { throw new Error('unreadable source'); },
    readManifest: moduleName => { const m = manifests[moduleName]; if (typeof m === 'string') throw new Error('unreadable manifest'); return m; },
  });
  assert.equal(directory.isOfficial('declared_official'), true);
  assert.equal(directory.providerOf('declared_official'), '@deepseek-ai/dsh-tool-x');
  assert.equal(directory.providerOf('anything'), undefined);
});

test('a declared third-party tool is quarantined on failure', () => {
  const f = setup();
  const plain = def('declared_role');
  delete plain.deepPtc;
  f.live.set('declared_role', plain);
  const directory = { isOfficial: () => false, isExternal: name => name === 'declared_role', providerOf: name => name === 'declared_role' ? 'dsh-task-dispatcher' : undefined, namesOf: () => new Set() };
  const state = createCompatibilityState(f.tools, [], f.storage, directory);
  const exec = { name: 'declared_role', agent: f.agent };
  state.dispatched(exec);
  state.observe(exec, broken);
  assert.equal(state.status(f.agent).blocked[0].provider, 'dsh-task-dispatcher');
  assert.equal(state.guard(exec)?.includes('quarantined'), true);
});

test('tool names are read from installed source without running it', () => {
  const source = `const EXIT = "exit_plan_mode";
    ctx.tools.register(defineTool({
      name: "terminal_open", description: "x" }));
    const tool = defineTool({ name: EXIT, output: {} });
    ctx.tools.register({ name: 'plain_tool' });
    const Config = z.object({ toolName: z.string().default("workflow") });
    ctx.tools.register(defineTool({ name: toolName }));
    ctx.tools.register(defineTool({ name: unknownName }));
    ctx.tools.register(definition);`;
  assert.deepEqual([...toolNamesInSource(source)].sort(), ['exit_plan_mode', 'plain_tool', 'terminal_open', 'workflow']);
});

test('the tool directory separates official tools from third-party ones and attributes both', () => {
  let reads = 0;
  const sources = { '@deepseek-ai/dsh-tool-terminal': 'defineTool({ name: "terminal_open" })', 'third-party-plugin': 'defineTool({ name: "better_read" })',
    '@vendor/renamed': 'defineTool({ name: "renamed_read" })', '@deepseek-ai/dsh-tool-off': 'defineTool({ name: "off_tool" })', 'dsh-deep-ptc-mode/guard': 'defineTool({ name: "ours" })' };
  const entries = [
    { options: { name: '@deepseek-ai/dsh-tool-terminal' } },
    { options: { name: '@deepseek-ai/dsh-tool-subagent', config: { toolName: 'subagent' } } },
    { options: { name: '@deepseek-ai/dsh-tool-off' }, disabled: true },
    { options: { name: 'third-party-plugin' } },
    { options: { name: 'dsh-deep-ptc-mode/guard' } },
    { options: { name: 'cordis:group' } },
    { options: { name: '@deepseek-ai/dsh-unreadable' } },
  ];
  const directory = toolDirectory(() => ({ entries: () => entries }), { modules: [{ name: '@vendor/renamed' }, { name: '@vendor/named', toolName: 'named_tool' }], readSource: moduleName => {
    reads++;
    if (!(moduleName in sources)) throw new Error('unreadable');
    return sources[moduleName];
  } });
  for (const name of ['terminal_open', 'subagent', 'renamed_read', 'named_tool']) assert.equal(directory.isOfficial(name), true, name);
  for (const name of ['better_read', 'off_tool', 'ours', 'nothing']) assert.equal(directory.isOfficial(name), false, name);
  assert.equal(directory.providerOf('better_read'), 'third-party-plugin');
  assert.equal(directory.providerOf('terminal_open'), '@deepseek-ai/dsh-tool-terminal');
  assert.equal(directory.providerOf('nothing'), undefined);
  const before = reads;
  directory.isOfficial('terminal_open');
  assert.equal(reads, before, 'installed source is read once');
  assert.equal(toolDirectory(() => undefined).isOfficial('x'), false);
  assert.equal(toolDirectory(() => { throw new Error('no loader'); }).isOfficial('x'), false);
});

test('a third-party tool is reported under the plugin that declares it', () => {
  const f = setup();
  const plain = def('plain_tool');
  delete plain.deepPtc;
  f.live.set(plain.name, plain);
  const state = createCompatibilityState(f.tools, [], f.storage, { providerOf: name => name === 'plain_tool' ? 'third-party-plugin' : undefined });
  const exec = { name: 'plain_tool', agent: f.agent };
  state.dispatched(exec);
  state.observe(exec, broken);
  assert.equal(state.status(f.agent).blocked[0].provider, 'third-party-plugin');
});

test('official rows stay exactly as declared; only the feature rows are wrapped', () => {
  const { preset } = deriveDeepPtc(snapshot, { environment: 'wsl' }, 'win32');
  const original = new Map(snapshot.plugins.map(row => [row.id, row]));
  // tool-subagent gains the delegation routing whitelist by derivation
  // (spec issue-151); every other official row must be untouched.
  for (const row of preset.plugins) {
    if (!original.has(row.id) || ['persona', 'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-ask-user', 'tool-subagent', 'delegation'].includes(row.id)) continue;
    assert.deepEqual(row, original.get(row.id));
  }
  assert.ok(!JSON.stringify(preset.plugins).includes('official-tools'));
  const fallback = deriveDeepPtc(snapshot, { environment: 'wsl', mappedExecutor: false }, 'win32').preset;
  assert.deepEqual(fallback.plugins.find(row => row.id === 'tool-bash'), original.get('tool-bash'), 'kept shell rows are unchanged');
});

test('safe mode is the official composition with only the persona changed', () => {
  const { preset, report } = deriveDeepPtc(snapshot, { environment: 'wsl', safeMode: true }, 'win32');
  assert.equal(report.environment, 'official');
  assert.deepEqual(preset.plugins.map(row => row.name), snapshot.plugins.map(row => row.name));
  assert.equal(preset.id, 'deep-ptc');
  assert.ok(preset.plugins[0].config.suffix.length > 100);
});

test('a failure in this layer leaves tool calls and prompts alone', () => {
  const f = setup(), events = new Map(), guards = [], warnings = [];
  const throwing = { read() { throw new Error('projection inactive'); }, write() { throw new Error('no store'); } };
  const ctx = { tools: { ...f.tools, guard: g => guards.push(g) }, systemPrompt: { section() {}, context(row) { ctx.contextText = row.text; } },
    on: (name, fn) => events.set(name, fn), effect() {}, logger: { warn: (...args) => warnings.push(args) } };
  installToolCompatibility(ctx, { storage: throwing });
  const exec = { name: 'better_read', agent: f.agent };
  assert.equal(guards[0](exec), undefined);
  let ran = 0;
  events.get('tools/execute')(exec, () => ++ran);
  assert.equal(ran, 1, 'the call still runs');
  assert.doesNotThrow(() => events.get('tools/result')(exec, broken));
  assert.equal(ctx.contextText({ scope: f.agent }), '');
  assert.ok(warnings.length >= 1 && warnings.length <= 4, 'each failing hook warns once');
  guards[0](exec);
  assert.ok(warnings.length <= 4);
  assert.equal(failOpen({}, 'x', () => { throw new Error('y'); }, 'fallback')(), 'fallback');
});

test('error codes are read from where the host reports them', () => {
  const coded = code => ({ isError: true, error: { message: 'x', info: { name: 'HarnessError', code } } });
  assert.equal(classifyToolOutcome({}, coded('INVALID_ARGS')).kind, 'input');
  assert.equal(classifyToolOutcome({}, coded('PERMISSION_DENIED')).kind, 'denied');
  assert.equal(classifyToolOutcome({}, coded('TOOL_ABORTED')).kind, 'cancelled');
  assert.equal(classifyToolOutcome({}, coded('WORKER_UNAVAILABLE')).kind, 'unavailable');
  assert.equal(classifyToolOutcome({}, coded('REQUEST_TIMEOUT')).kind, 'temporary');
});

test('stale persisted official marks cannot affect any official tool operation', () => {
 const f=setup(); f.storage.write(f.session,{...blankState(),blocked:[{name:'read',provider:'old mistake',kind:'failure'}],report:{turn:1,tools:[{name:'read',provider:'old mistake',kind:'failure'}]}});
 assert.equal(f.state.guard({agent:f.agent,name:'read'}),undefined);
 assert.ok(f.state.sdkDefinitions(f.agent).some(d=>d.name==='read'));
 assert.ok(f.state.search(f.agent,{query:'read'},new Set(['read'])).results.some(d=>d.name==='read'));
 assert.equal(f.state.load(f.agent,['read']).loaded.length,1);
 assert.equal(f.state.status(f.agent).blocked.length,0);
 assert.equal(f.state.status(f.agent).report.tools.length,0);
 assert.doesNotMatch(f.state.text({scope:f.agent}),/old mistake/);
});
test('unattributed dynamic tools stay visible and cannot be quarantined', () => {
 const f=setup(); const dynamic=def('dynamic_official');delete dynamic.deepPtc;f.live.set(dynamic.name,dynamic);
 for(let i=0;i<5;i++)f.state.observe(f.call(dynamic.name),broken);
 assert.equal(f.state.guard(f.call(dynamic.name)),undefined);
 assert.ok(f.state.sdkDefinitions(f.agent).some(d=>d.name===dynamic.name));
 assert.equal(f.state.status(f.agent).blocked.length,0);
});
test('a missing executable is a provider failure, while a missing input is not',()=>{
 assert.equal(classifyToolOutcome({}, {isError:true,error:{info:{code:'ENOENT'},message:'spawn missing-worker ENOENT'}}).kind,'unavailable');
 assert.equal(classifyToolOutcome({}, {isError:true,error:{info:{code:'ENOENT'},message:'open input.txt ENOENT'}}).kind,'input');
});
test('a tool without output metadata does not crash catalog disclosure',()=>{
 const f=setup();f.live.set('legacy',{name:'legacy',description:'legacy',parameters:{type:'object'},deepPtc:{provider:'p'}});
 assert.equal(f.state.load(f.agent,['legacy']).loaded[0].name,'legacy');
});

test('source discovery rereads changed modules without pinning a DSH version',()=>{
 let source='ctx.tools.register({ name: "before_update" });';
 const directory=toolDirectory(()=>({entries:()=>[]}),{modules:[{name:'@deepseek-ai/current-runtime'}],readSource:()=>source,refreshMs:0});
 assert.equal(directory.isOfficial('before_update'),true);
 source='ctx.tools.register({ name: "after_update" });';
 assert.equal(directory.isOfficial('after_update'),true);
 assert.equal(directory.isOfficial('before_update'),false);
});

test('a positively attributed external shadow never transfers quarantine to the restored official tool',()=>{
 const f=setup();const shadow={...def('read'),deepPtc:{provider:'replacement-plugin'}};f.live.set('read',shadow);
 const state=createCompatibilityState(f.tools,[],f.storage,{isOfficial:name=>name==='read'});
 const exec={agent:f.agent,name:'read'};state.dispatched(exec);state.observe(exec,broken);
 assert.match(state.guard(exec),/quarantined/);
 f.live.set('read',f.official);assert.equal(state.guard(exec),undefined);
 assert.ok(state.sdkDefinitions(f.agent).includes(f.official));
});

// ---- issue-234:归因盲区的可观测警告 ----

test('a tool with no provider attribution warns once and keeps its fail-open behaviour', () => {
  // 有定义、但既没标 provider、目录也不认识的工具:被当作 official(永不隔离)。
  // 这是刻意的 fail-open,但此前完全静默——失败时没人知道这个工具其实可能有问题。
  // 契约:每个工具名警告一次,且警告不改变隔离行为(仍不隔离)。
  const session = {}
  const agent = { session }
  const unattributable = { name: 'mystery_tool', description: 'no attribution info', parameters: { type: 'object' } }
  const attributed = { name: 'known_plugin_tool', description: 'has provider', deepPtc: { provider: 'example-plugin' }, parameters: { type: 'object' } }
  const live = new Map([[unattributable.name, unattributable], [attributed.name, attributed]])
  const tools = {
    get: (name, agent, admitted) => !admitted || admitted.has(name) ? live.get(name) : undefined,
    definitions: (agent, admitted) => [...live.values()].filter((d) => !admitted || admitted.has(d.name)),
  }
  const warnings = []
  const state = createCompatibilityState(tools, [], { read: () => blankState(), write: () => {} }, {}, {
    warn: (message) => warnings.push(message),
  })

  const first = { name: 'mystery_tool', agent }
  state.dispatched(first)
  assert.equal(warnings.length, 1, '归因失败应警告一次')
  assert.match(warnings[0], /mystery_tool/, '警告应点名该工具')

  // 同名字的后续调用不再重复警告(每工具名一次)。
  state.dispatched({ name: 'mystery_tool', agent })
  assert.equal(warnings.length, 1, '同一工具名只警告一次')

  // 归因成功的工具不触发警告。
  state.dispatched({ name: 'known_plugin_tool', agent })
  assert.equal(warnings.length, 1, '能归因的工具不警告')

  // fail-open 行为不变:归因失败的工具仍被当作 official,不进入隔离。
  const exec = { name: 'mystery_tool', agent }
  state.dispatched(exec)
  state.observe(exec, broken)
  state.observe(exec, broken)
  state.observe(exec, broken)
  assert.equal(state.guard({ name: 'mystery_tool', agent }), undefined, '归因失败的工具不得被隔离(行为不变)')
})

test('a missing definition does not warn (nothing was ever attributed)', () => {
  const session = {}
  const agent = { session }
  const tools = {
    get: () => undefined,
    definitions: () => [],
  }
  const warnings = []
  const state = createCompatibilityState(tools, [], { read: () => blankState(), write: () => {} }, {}, {
    warn: (message) => warnings.push(message),
  })
  state.dispatched({ name: 'never_defined', agent })
  assert.equal(warnings.length, 0, '没有定义的工具不是归因失败,不该警告')
})
