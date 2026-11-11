// Probe copy of the shipped bundle: lib/*.mjs -> <tmp>/lib/*.mjs.
//
// index.js imports ./lib/*.mjs, so a test that boots it needs the
// generated copy to exist. Building it **inside the checkout** would rewrite the
// very artifacts under test, which makes a stale lib/ impossible to
// detect (the test repairs it and then passes). Instead we assemble a probe
// directory: <tmp>/plugin/{index.js,client.js,cordis.patch.yml,package.json,lib/}
// and import that. The checkout is never written to, so `build:check` stays
// honest.
//
// Adapters that need to point the bundle at test config still set the same env
// vars: this only changes where the code is read from, not how it is configured.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Engine modules the bundle ships; mirrors scripts/build-plugin.mjs MODULES. */
export const MODULES = ['core', 'http', 'runtime', 'balance', 'api'];

/** Files copied verbatim from plugin/ so the probe bundle is complete. */
const PLUGIN_FILES = ['index.js', 'client.js', 'cordis.patch.yml', 'package.json'];

/**
 * Assemble a runnable copy of the bundle outside the checkout.
 * @param {string} repoRoot checkout root (the directory holding lib/ and plugin/)
 * @returns {{ root: string, pluginDir: string, entry: string, url: string, cleanup: () => void }}
 */
export function makeProbeBundle(repoRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-probe-'));
// #182: cleanup() only runs on the success path. An assertion that fails
// first would leave this tree behind, and the gate now runs every suite.
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }))
  const pluginDir = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginDir, 'lib'), { recursive: true });

  for (const name of PLUGIN_FILES) {
    const from = path.join(repoRoot,  name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(pluginDir, name));
  }
  for (const name of MODULES) {
    const from = path.join(repoRoot, 'lib', `${name}.mjs`);
    if (!fs.existsSync(from)) throw new Error(`probe bundle: missing source lib/${name}.mjs`);
    fs.copyFileSync(from, path.join(pluginDir, 'lib', `${name}.mjs`));
  }

  const entry = path.join(pluginDir, 'index.js');
  return {
    root,
    pluginDir,
    entry,
    url: pathToFileURL(entry).href,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Resolve the checkout root from a test file's own location.
 * @param {string} importMetaUrl `import.meta.url` of the caller
 */
export function repoRootOf(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..');
}
