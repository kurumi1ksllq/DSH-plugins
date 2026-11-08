// Static + structural checks for the browser half of `dsh-websearch-failover`.
//
// The bundle is hand-authored (no build step), so these tests are the safety
// net: the file must parse as a classic script, register exactly one
// `__ModuleLoader__` factory, require nothing but `react`, and carry every HTTP
// route the host half serves. The provider manager itself is rendered by
// dsh-inventory's Tools page, so no sidebar slot is claimed here. The
// locale JSON files must stay flat and byte-identical to the strings the bundle
// registers through `ctx.locale.register`.
//
// Run with: node test/test-client-static.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const CLIENT = path.join(root, 'client.js');
const ZH = path.join(root, 'locale', 'zh.json');
const EN = path.join(root, 'locale', 'en.json');
const ICON = path.join(root, 'icon.svg');

const MODULE_ID = 'dsh-websearch-failover';
const LOCALE_NS = 'websearch-failover';
const PANEL_KEY = 'websearch-failover';

const REQUIRED_ROUTES = [
  '/websearch-failover/api/state',
  '/websearch-failover/api/order',
  '/websearch-failover/api/refresh',
  '/websearch-failover/api/enable',
];

const REQUIRED_LOCALE_KEYS = [
  'panel',
  'title',
  'hint',
  'refresh',
  'loading',
  'error',
  'unknownBalance',
  'priorityHint',
  'enable',
  'disable',
  'calls',
  'successes',
  'failures',
  'lastUsed',
  'cooldown',
  'keyMissing',
  'keyPresent',
  'rank',
  'back',
  'reset',
  'resetMonthlyFirst',
  'resetMonthlyAllowance',
  'resetNone',
];

/** Minimal React stand-in: enough for registration, never for rendering. */
const REACT_STUB = {
  createElement: function createElement() {
    return null;
  },
  useState: function useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, function noop() {}];
  },
  useEffect: function useEffect() {},
  useRef: function useRef() {
    return { current: null };
  },
  useMemo: function useMemo(factory) {
    return factory();
  },
  useCallback: function useCallback(fn) {
    return fn;
  },
  Fragment: 'Fragment',
};

function readClient() {
  assert.ok(fs.existsSync(CLIENT), `missing browser bundle: ${CLIENT}`);
  return fs.readFileSync(CLIENT, 'utf8');
}

function readJson(file) {
  assert.ok(fs.existsSync(file), `missing locale file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Execute the bundle against stubbed `window`/`require` and materialize its
 * factory, capturing every module request and the single loader registration.
 */
function loadBundle() {
  const source = readClient();
  const loads = [];
  const requireSpecs = [];
  const windowStub = {
    __ModuleLoader__: {
      load: function load(record) {
        loads.push(record);
      },
    },
  };
  const requireStub = function require(specifier) {
    requireSpecs.push(specifier);
    return REACT_STUB;
  };
  const run = new Function(
    'window',
    'require',
    'console',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    source,
  );
  run(
    windowStub,
    requireStub,
    console,
    function fetchStub() {
      return Promise.reject(new Error('network-disabled-in-test'));
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  );

  assert.equal(loads.length, 1, 'the bundle must call window.__ModuleLoader__.load exactly once');
  const record = loads[0];
  const plugin = record.factory(requireStub);
  return { source, record, plugin, requireSpecs };
}

/** Fake Cordis context that records what the plugin registers. */
function makeCtx() {
  const ledger = {
    localeNs: '',
    localeStrings: null,
    boundNs: '',
    registered: [],
    injected: [],
    effects: [],
    selectedPanel: 'unset',
  };

  const ctx = {
    effect: function effect(fn) {
      ledger.effects.push(fn());
    },
    locale: {
      register: function register(ns, definitions) {
        ledger.localeNs = ns;
        ledger.localeStrings = definitions;
        return function dispose() {};
      },
      bind: function bind(ns) {
        ledger.boundNs = ns;
        return function t(key) {
          const definitions = ledger.localeStrings;
          if (definitions && definitions.zh && typeof definitions.zh[key] === 'string') return definitions.zh[key];
          return key;
        };
      },
    },
    slots: {
      inject: function inject(name, factory) {
        ledger.injected.push(name);
        ledger.registered.push(factory());
        return function dispose() {};
      },
      register: function register(meta, component) {
        return { meta: meta, component: component };
      },
    },
    layout: {
      selectPanel: function selectPanel(value) {
        ledger.selectedPanel = value;
      },
    },
  };

  return { ledger, ctx };
}

test('client.js exists and parses as a classic browser script', () => {
  const source = readClient();
  const factory = new Function('window', 'require', 'document', source);
  assert.equal(typeof factory, 'function');
});

test('client.js passes node --check on a temp .cjs copy', () => {
  readClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wsf-client-'));
  const copy = path.join(dir, 'client.cjs');
  try {
    fs.writeFileSync(copy, readClient(), 'utf8');
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
  } catch (error) {
    const detail = error && error.stderr ? String(error.stderr) : String(error && error.message);
    assert.fail(`node --check rejected client.js:\n${detail}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bundle registers the module id, dictionary and no sidebar slot', () => {
  const { record, plugin, requireSpecs } = loadBundle();
  assert.equal(record.id, MODULE_ID);
  assert.equal(typeof record.factory, 'function');
  assert.equal(plugin.name, MODULE_ID);
  // The provider manager lives on dsh-inventory's Tools page, so the client
  // half owns the strings only: no slots, no layout, no shell dependency.
  assert.deepEqual(plugin.inject.slice().sort(), ['locale']);
  assert.ok(requireSpecs.includes('react'), 'the factory must require react');

  const { ledger, ctx } = makeCtx();
  plugin.apply(ctx);

  assert.equal(ledger.localeNs, LOCALE_NS);
  assert.deepEqual(ledger.injected, [], 'no sidebar entry or main panel may be registered');
  assert.equal(ledger.registered.length, 0, 'no slot registrations expected');
  assert.ok(ledger.effects.length >= 1, 'locale registration must run inside ctx.effect');

  assert.ok(ledger.localeStrings, 'ctx.locale.register must receive definitions');
  assert.equal(typeof ledger.localeStrings.zh, 'object');
  assert.equal(typeof ledger.localeStrings.en, 'object');
});

test('the provider strings the Tools page renders are all defined', () => {
  const { plugin } = loadBundle();
  const { ledger, ctx } = makeCtx();
  plugin.apply(ctx);

  // dsh-inventory renders this section with its own dictionary; these are the
  // provider keys it reads, and a missing one would surface as a raw key.
  const required = [
    'unknownBalance',
    'priorityHint',
    'enable',
    'disable',
    'calls',
    'successes',
    'failures',
    'lastUsed',
    'cooldown',
    'keyMissing',
    'keyPresent',
    'rank',
    'reset',
    'resetMonthlyFirst',
    'resetNone',
    'moveUp',
    'moveDown',
    'dragHint',
    'refreshOne',
    'unit.credits',
    'unit.usd',
    'status.ok',
    'status.cooldown',
    'status.unknown',
  ];
  for (const locale of ['zh', 'en']) {
    for (const key of required) {
      assert.equal(typeof ledger.localeStrings[locale][key], 'string', `${locale}.${key} missing`);
    }
  }
});

test('bundle carries every host API route as a literal', () => {
  const source = readClient();
  for (const route of REQUIRED_ROUTES) {
    assert.ok(source.includes(route), `client.js must contain the route literal ${route}`);
  }
  assert.ok(source.includes('JSON.stringify'), 'POST bodies must be JSON');
  assert.ok(source.includes("'content-type': 'application/json'"), 'POST requests must send JSON content-type');
});

test('the reorder UI no longer lives in this bundle', () => {
  // The provider manager's arrows and drag-and-drop moved to dsh-inventory's
  // Tools page together with the rest of the section. The behaviour is still
  // asserted, just from its new home:
  //   packages/dsh-inventory/test/client.test.mjs
  //     - "the tools page lists web-search providers with balances, priority
  //        order and detail" (arrow buttons, order POST, drag handlers)
  //   packages/dsh-inventory/client.js (draggable / onDragStart / dataTransfer)
  // Re-adding the UI here would put a second, unowned copy back in the product.
  const source = readClient();
  for (const token of ['draggable', 'onDragStart', 'onDragOver', 'onDrop', 'onDragEnd']) {
    assert.equal(source.includes(token), false, `this bundle must not ship the reorder UI again (${token})`);
  }
});

test('bundle requires nothing but react and uses no JSX/import/stylesheet', () => {
  const { source } = loadBundle();

  const staticSpecs = [];
  const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = requirePattern.exec(source)) !== null) staticSpecs.push(match[1]);
  assert.deepEqual(
    staticSpecs.filter(function only(spec) {
      return spec !== 'react';
    }),
    [],
    'the DSH module loader only seeds react; no other require() is allowed',
  );
  assert.ok(staticSpecs.length >= 1, 'the bundle must require react');

  assert.ok(!/^\s*import\s/m.test(source), 'the bundle must not use ESM import statements');
  assert.ok(!source.includes('jsx'), 'the bundle must not reference jsx-runtime');
  assert.ok(!source.includes('<style'), 'no inline <style> tags are allowed');
  assert.ok(!/\.css['"]/.test(source), 'no external stylesheet references are allowed');
  assert.ok(source.includes('var(--dsw-alias-'), 'styling must use DSH alias CSS variables');
});

test('locale JSON files are flat, identical, and cover the required keys', () => {
  const zh = readJson(ZH);
  const en = readJson(EN);

  for (const [name, map] of [
    ['zh', zh],
    ['en', en],
  ]) {
    const keys = Object.keys(map);
    assert.ok(keys.length > 0, `locale/${name}.json is empty`);
    for (const key of keys) {
      assert.equal(typeof map[key], 'string', `locale/${name}.json key "${key}" must map to a string`);
      assert.ok(map[key].length > 0, `locale/${name}.json key "${key}" is empty`);
      assert.ok(!key.includes(' '), `locale/${name}.json key "${key}" contains a space`);
    }
  }

  assert.deepEqual(
    Object.keys(zh).sort(),
    Object.keys(en).sort(),
    'locale/zh.json and locale/en.json must expose identical key sets',
  );

  const keys = new Set(Object.keys(zh));
  for (const key of REQUIRED_LOCALE_KEYS) {
    assert.ok(keys.has(key), `locale files are missing required key "${key}"`);
  }
});

test('locale JSON files match the strings registered by the bundle', () => {
  const { plugin, source } = loadBundle();
  const { ledger, ctx } = makeCtx();
  plugin.apply(ctx);

  const zh = readJson(ZH);
  const en = readJson(EN);

  assert.deepEqual(Object.keys(ledger.localeStrings.zh).sort(), Object.keys(zh).sort());
  assert.deepEqual(Object.keys(ledger.localeStrings.en).sort(), Object.keys(en).sort());
  for (const key of Object.keys(zh)) {
    assert.equal(ledger.localeStrings.zh[key], zh[key], `zh string drifted for key "${key}"`);
    assert.equal(ledger.localeStrings.en[key], en[key], `en string drifted for key "${key}"`);
  }

  const used = new Set();
  const pattern = /\bt\(\s*'([^']+)'\s*\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) used.add(match[1]);
  for (const key of used) {
    assert.ok(key in zh, `client.js calls t('${key}') but the locale files do not define it`);
  }
});

test('bundle draws balances proportionally and clamps bar widths', () => {
  const source = readClient();
  assert.ok(source.includes('.ratio'), 'balance ratio from the host payload must be used');
  assert.ok(source.includes('remaining'), 'remaining must be used for normalisation');
  assert.ok(source.includes('Math.max(0, Math.min(1'), 'bar widths must be clamped to 0..1');
  assert.ok(source.includes('isFinite'), 'numeric checks must reject NaN/Infinity');
});

test('icon.svg is a local currentColor SVG glyph', () => {
  assert.ok(fs.existsSync(ICON), `missing ${ICON}`);
  const svg = fs.readFileSync(ICON, 'utf8');
  assert.match(svg, /<svg[\s>]/);
  assert.match(svg, /viewBox="[^"]+"/);
  assert.match(svg, /currentColor/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), 'icon must not reference remote assets');
});
