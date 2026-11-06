// Integration check against a real DSH runtime: official jobs, tool registry, bash tool and local bash
// executor, with Deep PTC's wrappers and guard. Linux/macOS host; point PTC_RUNTIME_MODULES at the
// runtime's node_modules (for the desktop app: resources/app.asar extracted, dsh/node_modules).
//   PTC_RUNTIME_MODULES=/path/to/dsh/node_modules node scripts/check-reachability.mjs
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';

const modules = process.env.PTC_RUNTIME_MODULES;
if (!modules) throw new Error('Set PTC_RUNTIME_MODULES to the runtime node_modules directory');
const runtimeParent = pathToFileURL(path.join(modules, '__integration__.mjs')).href;
registerHooks({ resolve(specifier, context, next) {
  return specifier.startsWith('@deepseek-ai/') ? next(specifier, { ...context, parentURL: runtimeParent }) : next(specifier, context);
} });

const load = specifier => import(specifier);
const { Context, Service } = await load('@deepseek-ai/cordis');
const { default: SubprocessLocal } = await load('@deepseek-ai/dsh-subprocess-local');
const { LocalBashExecutor } = await load('@deepseek-ai/dsh-bash-local');
const { LocalJobRegistry } = await load('@deepseek-ai/dsh-jobs-local');
const { ToolRuntime } = await load('@deepseek-ai/dsh-tools');
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
const { UserQuestionService } = await load('@deepseek-ai/dsh-user-questions');
const { Session } = await load('@deepseek-ai/dsh-session');
const terminal = await load('../lib/terminal.mjs');
const jobsTool = await load('../lib/jobs-tool.mjs');
const guard = await load('../lib/guard.mjs');
const askUser = await load('../lib/ask-user.mjs');

const root = new Context();
const cwd = process.cwd();
class ShellEnv extends Service { constructor(ctx) { super(ctx, 'shellEnv'); } collect() { return {}; } }
class WorkingDirectory extends Service { constructor(ctx) { super(ctx, 'workingDirectory'); } resolve() { return cwd; } async ensure() { return cwd; } }
const agent = {
  id: 'agent-1', ctx: root, status: 'running', session: Session.create('agent-1'),
  inbox: { nextStep: [], nextTurn: [] }, inject() {}, followup() {},
};
class Agents extends Service { constructor(ctx) { super(ctx, 'agents'); } get(id) { return id === agent.id ? agent : undefined; } roots() { return [agent]; } }

await root.plugin(SystemPrompt, {});
for (const plugin of [ShellEnv, WorkingDirectory, Agents]) await root.plugin(plugin);
await root.plugin(SubprocessLocal, {});
await root.plugin(LocalBashExecutor, { timeoutMs: 6000, maxTimeoutMs: 6000 });
await root.plugin(LocalJobRegistry, {});
await root.plugin(ToolRuntime, {});
await root.plugin((await load('@deepseek-ai/dsh-commands')).default);
await root.plugin((await load('@deepseek-ai/dsh-session-projection')).default);
// From 0.2.2 tools dispatch through a selected executor as call batches.
const batches = typeof root.tools.setExecutor === 'function';
if (batches) await root.plugin(await load('@deepseek-ai/dsh-tool-executor-native'));
await root.plugin(jobsTool, { upstream: '@deepseek-ai/dsh-tool-jobs', options: { waitTimeoutMs: 30000, maxWaitTimeoutMs: 30000 } });
await root.plugin(terminal, { upstream: '@deepseek-ai/dsh-tool-bash' });
await root.plugin(UserQuestionService, {});
await root.plugin(askUser, { upstream: '@deepseek-ai/dsh-tool-ask-user', options: { mode: 'timed', timeout: 120 } });
await root.plugin(guard, { foregroundSeconds: 6, maxQuestionSeconds: 300, maxPollsPerProgram: 3 });
// The cooperation observer must not change shell waits, questions, jobs or steering.
await root.plugin(await load('../lib/tool-compatibility.mjs'), {});
for (let i = 0; i < 100 && !root.tools.get('deep_ptc_tools', agent); i++) await new Promise(resolve => setTimeout(resolve, 10));
assert.ok(root.tools.get('deep_ptc_tools', agent), 'the complete 1.7.2 layer must be active during reachability tests');

let calls = 0;
const run = async (name, args) => {
  const controller = new AbortController();
  const callId = `call-${++calls}`;
  const started = Date.now();
  const result = batches
    ? (await root.tools.execute({ calls: [{ id: callId, name, arguments: JSON.stringify(args) }], agent, signal: controller.signal })).results[0].result
    : await root.tools.execute({ name, arguments: args, callId, agent, signal: controller.signal });
  return { result, text: result.content?.map(part => part.text).join('\n') ?? '', ms: Date.now() - started };
};
const steer = text => {
  const message = { id: `m-${Date.now()}`, source: { kind: 'user' }, content: text };
  agent.inbox.nextStep.push(message);
  root.emit('agent/inbox/inserted', { agent, message });
};
const read = () => { agent.inbox.nextStep = []; };
const longCommand = 'for i in $(seq 1 150); do sleep 0.1; done; echo finished';
const report = [];

{
  const quick = await run('bash', { description: 'quick', command: 'echo ready' });
  assert.match(quick.text, /ready/);
  report.push(`quick command: ${quick.ms} ms, normal result`);
}
{
  setTimeout(() => steer('change of plan'), 1000);
  const steered = await run('bash', { description: 'long', command: longCommand });
  assert.match(steered.text, /moved to background job/);
  assert.ok(steered.ms < 4500, `foreground call returned after ${steered.ms} ms`);
  const id = steered.text.match(/background job (\S+?)\]/)[1];
  assert.equal(root.jobs.list(agent.id).find(job => job.id === id)?.status, 'running');
  report.push(`steered during a 15 s command: returned after ${steered.ms} ms, job ${id} still running`);
  const denied = await run('job_output', { job_id: id, wait: true });
  assert.match(denied.text, /user sent a new message/);
  report.push('job_output wait while the message is unread: refused');
  read();
  setTimeout(() => steer('another note'), 1000);
  const waited = await run('job_output', { job_id: id, wait: true, timeout_ms: 30000 });
  assert.ok(waited.ms < 4500, `job_output returned after ${waited.ms} ms`);
  report.push(`steered during job_output wait: returned after ${waited.ms} ms`);
  read();
  root.jobs.kill(id, agent.id, 'check finished');
}
{
  const capped = await run('bash', { description: 'long', command: longCommand, timeoutMs: 600000 });
  assert.match(capped.text, /moved to background job/);
  assert.ok(capped.ms >= 5500 && capped.ms < 9000, `cap promoted after ${capped.ms} ms`);
  report.push(`no message, timeoutMs 600000 requested: promoted at the 6 s cap after ${capped.ms} ms`);
  root.jobs.kill(capped.text.match(/background job (\S+?)\]/)[1], agent.id, 'check finished');
}
{
  const slept = await run('bash', { description: 'sleep', command: 'sleep 60' });
  assert.equal(slept.result.isError, true);
  assert.match(slept.text, /refuses a 60 s foreground pause/);
  assert.ok(slept.ms < 1000);
  report.push(`foreground sleep 60: refused in ${slept.ms} ms`);
  const background = await run('bash', { description: 'sleep', command: 'sleep 60', run_in_background: true });
  assert.match(background.text, /started background job/);
  report.push('sleep 60 with run_in_background: allowed');
  root.jobs.kill(background.text.match(/background job (\S+)/)[1], agent.id, 'check finished');
}
{
  const question = { id: 'route', question: 'Which route?', options: [{ label: 'A' }, { label: 'B' }] };
  setTimeout(() => steer('use B'), 1000);
  const asked = await run('ask_user_question', { questions: [question], timeout: 120 });
  assert.match(asked.text, /pending/);
  assert.ok(asked.ms < 2500, `question wait ended after ${asked.ms} ms`);
  report.push(`steered during a 120 s question: pending after ${asked.ms} ms`);
  read();
  const forever = await run('ask_user_question', { questions: [question], timeout: -1 });
  assert.match(forever.text, /timeout <= 300/);
  report.push('question with timeout -1: refused');
}
console.log(report.map(line => `ok  ${line}`).join('\n'));
await new Promise(resolve => setTimeout(resolve, 500));
process.exit(0);
