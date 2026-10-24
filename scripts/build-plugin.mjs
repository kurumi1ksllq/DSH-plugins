#!/usr/bin/env node
// Assemble the shipped bundle's runtime copy: lib/*.mjs -> plugin/lib/*.mjs.
//
// The host half (plugin/index.js) imports ./lib/*.mjs so the installed bundle is
// self-contained: nothing under <profile>/node_modules/dsh-websearch-failover
// reaches back into this checkout. plugin/lib/ is generated output and gitignored;
// lib/ is the single source of truth.
//
//   node scripts/build-plugin.mjs            copy lib/ -> plugin/lib/
//   node scripts/build-plugin.mjs --check    exit 1 when plugin/lib is missing/stale
//   node scripts/build-plugin.mjs --root DIR operate on another checkout (tests)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Engine modules the bundle ships. Order is only cosmetic for the report. */
export const MODULES = ['core', 'http', 'runtime', 'balance', 'api'];

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = { check: false, root: path.resolve(HERE, '..') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--root') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--root needs a directory');
      options.root = path.resolve(value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/build-plugin.mjs [--check] [--root <checkout>]');
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

/**
 * Compare sources with generated copies.
 * @returns {{ missing: string[], stale: string[], current: string[], orphan: string[], sources: Map<string, string> }}
 */
function inspect(root) {
  const libDir = path.join(root, 'lib');
  const outDir = path.join(root, 'plugin', 'lib');
  const missing = [];
  const stale = [];
  const current = [];
  const sources = new Map();
  for (const name of MODULES) {
    const from = path.join(libDir, `${name}.mjs`);
    if (!fs.existsSync(from)) {
      missing.push(from);
      continue;
    }
    const content = fs.readFileSync(from, 'utf8');
    sources.set(name, content);
    const to = path.join(outDir, `${name}.mjs`);
    if (!fs.existsSync(to)) stale.push(`${name}.mjs (missing)`);
    else if (fs.readFileSync(to, 'utf8') !== content) stale.push(`${name}.mjs (differs)`);
    else current.push(`${name}.mjs`);
  }
  const expected = new Set(MODULES.map((name) => `${name}.mjs`));
  const orphan = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).filter((file) => file.endsWith('.mjs') && !expected.has(file))
    : [];
  return { missing, stale, current, orphan, sources };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = options.root;
  const result = inspect(root);

  if (result.missing.length > 0) {
    console.error('build-plugin: missing engine sources (lib/ is the source of truth):');
    for (const file of result.missing) console.error(`  - ${file}`);
    console.error('Create the missing module(s) under lib/, then re-run this build.');
    process.exit(1);
  }

  const outDir = path.join(root, 'plugin', 'lib');

  if (options.check) {
    if (result.stale.length === 0 && result.orphan.length === 0) {
      console.log(`build-plugin: plugin/lib is up to date (${result.current.length} files)`);
      return;
    }
    console.error('build-plugin: plugin/lib is stale — run `node scripts/build-plugin.mjs`');
    for (const entry of result.stale) console.error(`  - ${entry}`);
    for (const entry of result.orphan) console.error(`  - ${entry} (orphan, no matching lib/ source)`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const name of MODULES) {
    const to = path.join(outDir, `${name}.mjs`);
    if (fs.existsSync(to) && fs.readFileSync(to, 'utf8') === result.sources.get(name)) {
      console.log(`build-plugin: unchanged ${path.relative(root, to)}`);
      continue;
    }
    fs.writeFileSync(to, result.sources.get(name), 'utf8');
    console.log(`build-plugin: wrote ${path.relative(root, to)}`);
  }
  for (const file of result.orphan) {
    fs.rmSync(path.join(outDir, file), { force: true });
    console.log(`build-plugin: removed orphan ${path.join('plugin', 'lib', file)}`);
  }
  console.log(`build-plugin: plugin/lib ready (${MODULES.length} modules from lib/)`);
}

try {
  main();
} catch (error) {
  console.error(`build-plugin: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
