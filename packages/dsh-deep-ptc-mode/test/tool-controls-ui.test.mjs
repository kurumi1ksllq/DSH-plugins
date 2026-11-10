import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { skipUnlessModules } from './support/prerequisites.mjs';

const uiSkip = skipUnlessModules(['react', 'react-test-renderer']);
const testOrSkip = (title, fn) => (uiSkip === undefined ? test(title, fn) : test(title, { skip: uiSkip }, () => {}));

const React = uiSkip === undefined ? (await import('react')).default : undefined;
const { default: Renderer, act } = uiSkip === undefined ? await import('react-test-renderer') : {};

function fixture() {
  let plugin, component, descriptor;
  const calls = [];
  let outcome = { ok: true, value: { commandId: 'test-command', result: { kind: 'success' } } };
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: definition => {
      // #112 双模块文件:本套件只测 deep-ptc 的 composer dock 段
      if (definition.id !== 'dsh-deep-ptc-mode') return;
      plugin = definition.factory(() => React);
    } } },
  });
  const ctx = { locale: { bind: () => key => key, register() {} }, effect: fn => fn(),
    configForms: { get() {}, whileServed: () => () => {} },
    remote: { commands: { async execute(...args) { calls.push(args); return outcome; } } },
    slots: { inject: (name, callback) => callback(), register: (slot, render) => { descriptor = slot; component = render; } },
  };
  ctx.inject = (deps, callback) => { assert.deepEqual(Array.from(deps), ['remote', 'remote.commands']); callback(ctx); };
  plugin.apply(ctx);
  return { component, descriptor, calls, setOutcome: value => outcome = value };
}
testOrSkip('reload button is in the composer footer and resets only the current conversation through the host command', async () => {
  const f = fixture();
  assert.equal(f.descriptor.name, 'conversation.composer.dock');
  const injected = f.descriptor.inject('session-A');
  let view;
  await act(async () => { view = Renderer.create(React.createElement(f.component, { ...injected,
    useProjection: key => key === 'agentPreset' ? 'deep-ptc' : { report: { tools: [{name:'bad_tool',provider:'example-plugin'}] } } })); });
  assert.equal(view.root.findByType('button').props.children, 'toolReset');
  assert.match(JSON.stringify(view.toJSON()), /bad_tool/);
  await act(async () => { await view.root.findByType('button').props.onClick(); });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'session-A');
  assert.equal(f.calls[0][1], '/deep-ptc-reset-tools');
  assert.match(JSON.stringify(view.toJSON()), /toolResetDone/);
  await act(async () => view.unmount());
});
testOrSkip('server denial is displayed as failure; the UI never claims a successful reset', async () => {
  const f = fixture();
  f.setOutcome({ ok: false, error: { code: 'access-denied', message: 'access denied' } });
  let view;
  await act(async () => { view = Renderer.create(React.createElement(f.component, { ...f.descriptor.inject('s'), useProjection: key => key === 'agentPreset' ? 'deep-ptc' : {blocked:[],report:null} })); });
  await act(async () => { await view.root.findByType('button').props.onClick(); });
  assert.match(JSON.stringify(view.toJSON()), /toolResetFailed/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /toolResetDone/);
  await act(async () => view.unmount());
});
testOrSkip('other modes do not show Deep PTC tool controls', async () => {
  const f = fixture(); let view;
  await act(async () => { view = Renderer.create(React.createElement(f.component, { ...f.descriptor.inject('s'), useProjection: () => 'standard' })); });
  assert.equal(view.toJSON(), null);
  assert.equal(f.calls.length, 0);
  await act(async () => view.unmount());
});
