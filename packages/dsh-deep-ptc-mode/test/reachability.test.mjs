import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import template from '../lib/preset.json' with { type: 'json' };
import { configuredPreset, normalizeForegroundSeconds } from '../lib/model.mjs';
import { programPauseIssue, shellPauseSeconds } from '../lib/sleep-lint.mjs';
import { reachabilityGuard } from '../lib/rules.mjs';
import { finishPromoted, steerableJobs, steerableQuestions, steerableTool, steeringWatch } from '../lib/reachable.mjs';

const config = { foregroundSeconds: 30, maxQuestionSeconds: 300, maxPollsPerProgram: 3 };

function fakeAgent(id = 'agent-1') {
  return { id, inbox: { nextStep: [], nextTurn: [] } };
}

function fakeHost() {
  const events = new EventEmitter();
  return {
    ctx: { on: (name, listener) => { events.on(name, listener); return () => events.off(name, listener); } },
    steer(agent, text = 'hi', target = 'nextStep') {
      const message = { id: `m${Math.random()}`, source: { kind: 'user' }, content: text };
      agent.inbox[target].push(message);
      events.emit('agent/inbox/inserted', { agent, message });
    },
  };
}

// A registry whose job settles after `ms`, honouring wait timeouts and abort signals like dsh-jobs-local.
function fakeJobs(ms) {
  let settled = false;
  const done = new Promise(resolve => setTimeout(() => { settled = true; resolve(); }, ms));
  return {
    waits: [],
    async wait(id, timeoutMs, owner, signal) {
      this.waits.push(timeoutMs);
      if (signal?.aborted) throw new Error('wait aborted');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, timeoutMs);
        done.then(() => { clearTimeout(timer); resolve(); });
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('wait aborted')); }, { once: true });
      });
      return { id, status: settled ? 'completed' : 'running' };
    },
    list: () => [],
  };
}

test('shell pauses are measured across bash, zsh, PowerShell and cmd forms', () => {
  assert.equal(shellPauseSeconds('npm test'), 0);
  assert.equal(shellPauseSeconds('sleep 2 && curl localhost'), 2);
  assert.equal(shellPauseSeconds('until curl -s localhost; do sleep 1; done'), 1);
  assert.equal(shellPauseSeconds('sleep 60'), 60);
  assert.equal(shellPauseSeconds('make; sleep 2m'), 120);
  assert.equal(shellPauseSeconds('sleep infinity'), Infinity);
  assert.equal(shellPauseSeconds('Start-Sleep -Seconds 30'), 30);
  assert.equal(shellPauseSeconds('Start-Sleep 10'), 10);
  assert.equal(shellPauseSeconds('Start-Sleep -Milliseconds 500'), 0.5);
  assert.equal(shellPauseSeconds('timeout /t 20 /nobreak'), 20);
  assert.equal(shellPauseSeconds('echo sleeping 30'), 0);
});

test('run_code programs may pause briefly but not wait on timers or block the thread', () => {
  assert.equal(programPauseIssue('await new Promise(r => setTimeout(r, 1000)); return 1'), undefined);
  assert.equal(programPauseIssue("import { setTimeout } from 'node:timers/promises'; await setTimeout(2000)"), undefined);
  assert.equal(programPauseIssue('setTimeout(() => done(), 0)'), undefined);
  assert.match(programPauseIssue('await new Promise(r => setTimeout(r, 60_000))'), /60000 ms/);
  assert.equal(programPauseIssue('const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(500)'), undefined);
  assert.equal(programPauseIssue('setInterval(check, 1000)'), undefined);
  assert.match(programPauseIssue('Atomics.wait(view, 0, 0)'), /Atomics/);
  assert.match(programPauseIssue('import time\ntime.sleep(30)', 'python'), /30 s/);
  assert.equal(programPauseIssue('import asyncio\nawait asyncio.sleep(1)'), undefined);
  assert.match(programPauseIssue('from time import sleep\nsleep(10)', 'python'), /10 s/);
  assert.equal(programPauseIssue('const sleepy = "sleep(100)"'), undefined);
});

test('the guard refuses waiting and leaves ordinary work alone', () => {
  const agent = fakeAgent();
  const running = { id: 'job-1', status: 'running' };
  const guard = reachabilityGuard(config, () => ({ list: () => [running] }));
  const call = (name, args, extra = {}) => guard({ name, arguments: args, agent, callId: 'c', rootCallId: 'c', ...extra });
  assert.equal(call('bash', { command: 'npm test' }), undefined);
  assert.match(call('bash', { command: 'sleep 120' }), /120 s foreground pause/);
  assert.equal(call('bash', { command: 'sleep 120', run_in_background: true }), undefined);
  assert.match(call('pwsh', { command: 'Start-Sleep -Seconds 60' }), /60 s/);
  assert.match(call('zsh', { command: 'sleep infinity' }), /endless/);
  assert.match(call('run_code', { code: 'await new Promise(r => setTimeout(r, 30000))' }), /run_code programs that wait/);
  assert.equal(call('run_code', { code: 'return await tools.bash({ command: "ls" })' }), undefined);
  assert.match(call('ask_user_question', { questions: [], timeout: -1 }), /timeout <= 300/);
  assert.match(call('ask_user_question', { questions: [], timeout: 900 }), /timeout <= 300/);
  assert.equal(call('ask_user_question', { questions: [], timeout: 120 }), undefined);
  assert.equal(call('job_output', { job_id: 'job-1', wait: true }), undefined);
  agent.inbox.nextStep.push({ id: 'm1', source: { kind: 'user' } });
  assert.match(call('job_output', { job_id: 'job-1', wait: true }), /user sent a new message/);
  assert.equal(call('job_output', { job_id: 'job-1' }), undefined);
});

test('polling one running job inside a single run_code program is capped', () => {
  const agent = fakeAgent();
  const guard = reachabilityGuard(config, () => ({ list: () => [{ id: 'job-1', status: 'running' }] }));
  const poll = root => guard({ name: 'job_output', arguments: { job_id: 'job-1' }, agent, callId: `${root}-${Math.random()}`, rootCallId: root });
  for (let i = 0; i < 3; i++) assert.equal(poll('program-a'), undefined);
  assert.match(poll('program-a'), /refuses polling job job-1/);
  assert.equal(poll('program-b'), undefined);
  assert.equal(guard({ name: 'job_output', arguments: { job_id: 'job-1' }, agent, callId: 'top', rootCallId: 'top' }), undefined);
});

test('a foreground wait yields shortly after the user steers, and the job keeps running', async () => {
  const host = fakeHost();
  const watch = steeringWatch(host.ctx);
  const jobs = fakeJobs(10_000);
  const agent = fakeAgent();
  const controller = new AbortController();
  const tool = steerableTool({ name: 'bash', async execute() {
    const view = await steerableJobs(jobs, watch).wait('job-1', 30_000, agent.id, controller.signal);
    return { kind: view.status === 'running' ? 'promoted' : 'foreground', timeoutMs: 30_000 };
  } }, finishPromoted);
  const started = Date.now();
  const result = tool.execute({}, { agent, signal: controller.signal });
  setTimeout(() => host.steer(agent), 50);
  const value = await result;
  const elapsed = Date.now() - started;
  assert.equal(value.kind, 'promoted');
  assert.ok(elapsed < 3_000, `yielded after ${elapsed} ms`);
  assert.ok(value.timeoutMs < 3_000, 'reports the real elapsed time');
});

test('a wait for a command that finishes inside the grace period still returns its result', async () => {
  const host = fakeHost();
  const watch = steeringWatch(host.ctx);
  const jobs = fakeJobs(300);
  const agent = fakeAgent();
  host.steer(agent);
  const signal = new AbortController().signal;
  const tool = steerableTool({ name: 'bash', execute: () => steerableJobs(jobs, watch).wait('job-1', 30_000, agent.id, signal) });
  const view = await tool.execute({}, { agent, signal });
  assert.equal(view.status, 'completed');
});

test('queued follow-ups, other agents and waits outside a tool call do not yield', async () => {
  const host = fakeHost();
  const watch = steeringWatch(host.ctx);
  const agent = fakeAgent();
  const other = fakeAgent('agent-2');
  const signal = new AbortController().signal;
  const jobs = fakeJobs(400);
  const tool = steerableTool({ name: 'bash', execute: () => steerableJobs(jobs, watch).wait('job-1', 30_000, agent.id, signal) });
  const pending = tool.execute({}, { agent, signal });
  setTimeout(() => { host.steer(agent, 'later', 'nextTurn'); host.steer(other); }, 20);
  assert.equal((await pending).status, 'completed');
  const direct = await steerableJobs(fakeJobs(100), watch).wait('job-2', 30_000, agent.id, signal);
  assert.equal(direct.status, 'completed');
});

test('cancelling the call still rejects the wait so the official tool can stop the command', async () => {
  const host = fakeHost();
  const watch = steeringWatch(host.ctx);
  const agent = fakeAgent();
  const controller = new AbortController();
  const tool = steerableTool({ name: 'bash', execute: () => steerableJobs(fakeJobs(10_000), watch).wait('job-1', 30_000, agent.id, controller.signal) });
  const pending = tool.execute({}, { agent, signal: controller.signal });
  setTimeout(() => controller.abort('user cancel'), 20);
  await assert.rejects(pending, /wait aborted/);
});

test('a timed question becomes pending when the user writes instead of answering', async () => {
  const host = fakeHost();
  const watch = steeringWatch(host.ctx);
  const agent = fakeAgent();
  const closed = [];
  const timeoutError = new Error('ASK_TIMED_OUT');
  const wait = { timeout: timeoutError, close(reason) { closed.push(reason); this.resolve({ pending: true }); } };
  const service = {
    waits: new Map([[agent, new Map([['call-1', wait]])]]),
    askTimed: () => new Promise(resolve => { wait.resolve = resolve; }),
  };
  const asking = steerableQuestions(service, watch).askTimed({ agent }, 'call-1', 120_000);
  setTimeout(() => host.steer(agent, 'actually, use option B'), 20);
  assert.deepEqual(await asking, { pending: true });
  assert.deepEqual(closed, [timeoutError]);
});

test('the preset wraps the official shell, job and question modules and caps the foreground wait', () => {
  const preset = configuredPreset(template, { environment: 'wsl', wslDistribution: 'Ubuntu', foregroundSeconds: 45 }, 'win32');
  const group = preset.plugins.find(row => row.id === 'execution');
  assert.deepEqual(group.config[0].config, { environment: 'wsl', wslDistribution: 'Ubuntu', base: '@deepseek-ai/dsh-bash-sandbox',
    options: { timeoutMs: 45000, maxTimeoutMs: 45000 } });
  assert.deepEqual(group.config[1], { id: 'tool-bash', name: 'dsh-deep-ptc-mode/terminal', config: { upstream: '@deepseek-ai/dsh-tool-bash' } });
  assert.deepEqual(preset.plugins.find(row => row.id === 'reachability').config, { foregroundSeconds: 45 });
  assert.deepEqual(preset.plugins.find(row => row.id === 'tool-jobs').config,
    { upstream: '@deepseek-ai/dsh-tool-jobs', overrides: { waitTimeoutMs: 45000, maxWaitTimeoutMs: 45000 } });
  assert.deepEqual(preset.plugins.find(row => row.id === 'tool-ask-user').config,
    { upstream: '@deepseek-ai/dsh-tool-ask-user', overrides: { mode: 'timed', timeout: 120 } });
  const pwsh = configuredPreset(template, { environment: 'powershell', wslDistribution: '' }, 'win32');
  assert.deepEqual(pwsh.plugins.find(row => row.id === 'execution').config[1].config, { upstream: '@deepseek-ai/dsh-tool-pwsh' });
  assert.deepEqual(pwsh.plugins.find(row => row.id === 'execution').config[0],
    { id: 'executor', name: '@deepseek-ai/dsh-pwsh-sandbox', config: { timeoutMs: 30000, maxTimeoutMs: 30000 } });
  const zsh = configuredPreset(template, { environment: 'zsh', wslDistribution: '' }, 'darwin');
  assert.deepEqual(zsh.plugins.find(row => row.id === 'execution').config[1],
    { id: 'tool-zsh', name: 'dsh-deep-ptc-mode/terminal', config: { upstream: '@deepseek-ai/dsh-tool-bash', dialect: 'zsh' } });
  assert.throws(() => normalizeForegroundSeconds(2), /5 to 600/);
});
