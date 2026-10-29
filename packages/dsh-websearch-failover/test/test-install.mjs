// install/uninstall contract for scripts/install.mjs + scripts/build-plugin.mjs.
// Everything runs against throwaway fixtures under the system temp dir — the real
// profile in ~/.dsh is never read or written here.
//   node test/test-install.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const INSTALL = path.join(REPO, 'scripts', 'install.mjs');
const BUILD = path.join(REPO, 'scripts', 'build-plugin.mjs');

const BUNDLE = 'dsh-websearch-failover';
const MARK_START = '# >>> websearch-failover';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-install-'));

const BASE_PATCH = [
  '# fixture profile patch layer',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '- insert:',
  '    - id: mcp-codegraph',
  '      name: "@deepseek-ai/dsh-mcp-client"',
  '',
].join('\n');

// ---------------------------------------------------------------- helpers

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function out(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function run(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_PROFILE_DIR: '', DSH_HOME: '', ...env },
  });
}

/** rel-path -> file content for every file under dir. */
function snapshot(dir) {
  const files = new Map();
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else files.set(rel, fs.readFileSync(full, 'utf8'));
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return files;
}

function backups(profile, base) {
  return fs
    .readdirSync(profile)
    .filter((name) => name.startsWith(`${base}.bak-websearch-failover-`))
    .sort();
}

function profileManifest(bundles) {
  return `${JSON.stringify(
    {
      name: 'dsh-profile-desktop',
      private: true,
      dependencies: { '@local/dsh-prompt-inject': 'link:E:/Project-hub/dsh-reverse-plugin/prompt-inject' },
      dsh: { profile: { bundles } },
    },
    null,
    2,
  )}\n`;
}

/** The exact `link:` spec the installer must pin for a given checkout. */
function linkSpec(root) {
  return `link:${path.join(root, 'plugin').replace(/\\/g, '/')}`;
}

function makeProfile(dir, bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
  fs.mkdirSync(dir, { recursive: true });
  write(path.join(dir, 'package.json'), profileManifest(bundles));
  write(path.join(dir, 'cordis.patch.yml'), BASE_PATCH);
  return dir;
}

/** A repo-shaped source tree: lib/*.mjs (engine sources) + plugin/ (shipped bundle). */
function makeSource(root) {
  write(path.join(root, 'lib', 'core.mjs'), "// fixture core\nexport const KIND = 'core';\n");
  write(path.join(root, 'lib', 'http.mjs'), "export const KIND = 'http';\n");
  write(path.join(root, 'lib', 'runtime.mjs'), "export const KIND = 'runtime';\n");
  write(path.join(root, 'lib', 'balance.mjs'), "export const KIND = 'balance';\n");
  write(path.join(root, 'lib', 'api.mjs'), "export const KIND = 'api';\n");
  write(
    path.join(root, 'plugin', 'package.json'),
    `${JSON.stringify(
      {
        name: BUNDLE,
        version: '0.0.0-fixture',
        private: true,
        type: 'module',
        main: './index.js',
        exports: { '.': './index.js', './client': './client.js' },
        dsh: {
          manifestVersion: 1,
          bundle: { patch: './cordis.patch.yml' },
          client: { platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-layout'] },
        },
      },
      null,
      2,
    )}\n`,
  );
  write(
    path.join(root, 'plugin', 'cordis.patch.yml'),
    `# fixture bundle patch\n- insert:\n    - id: websearch-failover\n      name: '${BUNDLE}'\n`,
  );
  write(path.join(root, 'plugin', 'index.js'), "export const inject = ['web', 'webServer'];\nexport function apply() {}\n");
  write(path.join(root, 'plugin', 'client.js'), "window.__ModuleLoader__.load({ id: 'dsh-websearch-failover', factory: () => ({}) });\n");
  write(path.join(root, 'plugin', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>\n');
  write(path.join(root, 'plugin', 'locale', 'zh.json'), '{"title":"搜索提供方"}\n');
  write(path.join(root, 'plugin', 'locale', 'en.json'), '{"title":"Search providers"}\n');
  // Legacy prototype leftovers at the plugin root must never be shipped.
  write(path.join(root, 'plugin', 'install.mjs'), '// legacy prototype installer\n');
  write(path.join(root, 'plugin', 'core.mjs'), '// legacy generated core copy\n');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(BUILD, path.join(root, 'scripts', 'build-plugin.mjs'));
  return root;
}

function assertInstalled(targetDir) {
  for (const file of [
    'package.json',
    'cordis.patch.yml',
    'index.js',
    'client.js',
    'icon.svg',
    'locale/zh.json',
    'locale/en.json',
    'lib/core.mjs',
    'lib/http.mjs',
    'lib/runtime.mjs',
    'lib/balance.mjs',
    'lib/api.mjs',
  ]) {
    assert.equal(fs.existsSync(path.join(targetDir, ...file.split('/'))), true, `expected ${file} in the installed package`);
  }
  assert.equal(fs.existsSync(path.join(targetDir, 'install.mjs')), false, 'legacy install.mjs must not be shipped');
  assert.equal(fs.existsSync(path.join(targetDir, 'core.mjs')), false, 'legacy plugin/core.mjs must not be shipped');
}

// ---------------------------------------------------------------- fixtures

const sourceRoot = makeSource(path.join(TMP, 'source'));
const profile = makeProfile(path.join(TMP, 'profile'));
const targetDir = path.join(profile, 'node_modules', BUNDLE);
const manifestPath = path.join(profile, 'package.json');
const patchPath = path.join(profile, 'cordis.patch.yml');
const ORIGINAL = snapshot(profile);

// 1) a profile without package.json must fail loudly ------------------------
{
  const empty = path.join(TMP, 'no-manifest');
  fs.mkdirSync(empty, { recursive: true });
  const result = run(INSTALL, ['--profile', empty, '--source', sourceRoot]);
  assert.notEqual(result.status, 0, 'installer must fail on a profile without package.json');
  assert.match(out(result), /package\.json/, 'error must name the missing profile manifest');
  console.log('PASS  profile without package.json fails loudly');
}

// 2) --dry-run writes nothing ----------------------------------------------
{
  const result = run(INSTALL, ['--dry-run', '--profile', profile, '--source', sourceRoot]);
  assert.equal(result.status, 0, out(result));
  assert.match(out(result), /would/i, 'dry-run must print planned actions');
  assert.match(out(result), /^ {4}\+ {5}searchProvider: websearch-failover$/m, 'dry-run must show a diff of the patch block');
  assert.match(out(result), /dry-run: nothing written/);
  assert.deepEqual(snapshot(profile), ORIGINAL, 'dry-run must not touch the profile');
  assert.equal(fs.existsSync(targetDir), false, 'dry-run must not copy the package');
  assert.equal(fs.existsSync(path.join(sourceRoot, 'plugin', 'lib')), false, 'dry-run must not run the build');
  console.log('PASS  --dry-run plans without writing');
}

// 3) install: package + bundles entry + marked patch block ------------------
let patchAfterFirst;
let manifestAfterFirst;
{
  const result = run(INSTALL, ['--profile', profile, '--source', sourceRoot]);
  assert.equal(result.status, 0, out(result));
  assertInstalled(targetDir);
  assert.equal(
    fs.existsSync(path.join(sourceRoot, 'plugin', 'lib', 'runtime.mjs')),
    true,
    'install must generate plugin/lib from lib/ before copying',
  );

  manifestAfterFirst = read(manifestPath);
  const expectedManifest = ORIGINAL.get('package.json')
    .replace(
      '        "@deepseek-ai/dsh-web-app"\n      ]',
      '        "@deepseek-ai/dsh-web-app",\n        "dsh-websearch-failover"\n      ]',
    )
    .replace(
      '"@local/dsh-prompt-inject": "link:E:/Project-hub/dsh-reverse-plugin/prompt-inject"\n  },',
      `"@local/dsh-prompt-inject": "link:E:/Project-hub/dsh-reverse-plugin/prompt-inject",\n    "dsh-websearch-failover": "${linkSpec(sourceRoot)}"\n  },`,
    );
  assert.equal(
    manifestAfterFirst,
    expectedManifest,
    'the bundles entry and the dependency pin must be inserted on their own, properly indented lines',
  );
  const parsed = JSON.parse(manifestAfterFirst);
  assert.deepEqual(parsed.dsh.profile.bundles.filter((name) => name === BUNDLE), [BUNDLE], 'bundles entry added exactly once');
  assert.ok(parsed.dsh.profile.bundles.includes('@deepseek-ai/dsh-web-app'), 'existing bundles must be preserved');
  assert.equal(
    parsed.dependencies[BUNDLE],
    linkSpec(sourceRoot),
    'the installer must pin the bundle as a link: dependency — an undeclared copy is what pnpm moves to node_modules/.ignored',
  );
  assert.equal(
    parsed.dependencies['@local/dsh-prompt-inject'],
    'link:E:/Project-hub/dsh-reverse-plugin/prompt-inject',
    'existing dependencies must be preserved',
  );

  patchAfterFirst = read(patchPath);
  assert.ok(patchAfterFirst.startsWith(BASE_PATCH), 'existing patch content must be preserved');
  assert.equal(patchAfterFirst.split(MARK_START).length - 1, 1, 'marked block appears exactly once');
  assert.match(patchAfterFirst, /^- id: web$/m);
  assert.match(patchAfterFirst, /^ {4}searchProvider: websearch-failover$/m);
  assert.match(patchAfterFirst, /^ {4}- id: websearch-failover$/m);
  assert.match(patchAfterFirst, new RegExp(`name: '${BUNDLE}'`));

  const manifestBackups = backups(profile, 'package.json');
  const patchBackups = backups(profile, 'cordis.patch.yml');
  assert.equal(manifestBackups.length, 1, 'one package.json backup');
  assert.equal(patchBackups.length, 1, 'one cordis.patch.yml backup');
  assert.equal(read(path.join(profile, manifestBackups[0])), ORIGINAL.get('package.json'));
  assert.equal(read(path.join(profile, patchBackups[0])), BASE_PATCH);
  console.log('PASS  install copies the bundle and wires bundles + patch block');
}

// 4) second install is a no-op ---------------------------------------------
{
  const result = run(INSTALL, ['--profile', profile, '--source', sourceRoot]);
  assert.equal(result.status, 0, out(result));
  assert.match(out(result), /unchanged/i, 'second install must report unchanged');
  assert.equal(read(manifestPath), manifestAfterFirst, 'manifest unchanged on re-install');
  assert.equal(read(patchPath), patchAfterFirst, 'patch unchanged on re-install');
  assert.equal(backups(profile, 'package.json').length, 1, 'no extra package.json backup');
  assert.equal(backups(profile, 'cordis.patch.yml').length, 1, 'no extra patch backup');
  console.log('PASS  re-install reports unchanged');
}

// 5) build --check catches stale plugin/lib --------------------------------
{
  let result = run(BUILD, ['--root', sourceRoot, '--check']);
  assert.equal(result.status, 0, out(result));
  assert.match(out(result), /up to date/);

  write(path.join(sourceRoot, 'lib', 'core.mjs'), "// fixture core v2\nexport const KIND = 'core-v2';\n");
  result = run(BUILD, ['--root', sourceRoot, '--check']);
  assert.notEqual(result.status, 0, '--check must exit 1 when plugin/lib is stale');
  assert.match(out(result), /stale/i);

  result = run(BUILD, ['--root', sourceRoot]);
  assert.equal(result.status, 0, out(result));
  assert.equal(read(path.join(sourceRoot, 'plugin', 'lib', 'core.mjs')), "// fixture core v2\nexport const KIND = 'core-v2';\n");
  result = run(BUILD, ['--root', sourceRoot, '--check']);
  assert.equal(result.status, 0, out(result));
  console.log('PASS  build is idempotent and --check detects stale output');
}

// 6) uninstall restores both profile files byte for byte -------------------
{
  const result = run(INSTALL, ['--profile', profile, '--source', sourceRoot, '--uninstall']);
  assert.equal(result.status, 0, out(result));
  assert.equal(read(manifestPath), ORIGINAL.get('package.json'), 'uninstall must restore package.json');
  assert.equal(read(patchPath), ORIGINAL.get('cordis.patch.yml'), 'uninstall must restore cordis.patch.yml');
  assert.equal(fs.existsSync(targetDir), false, 'uninstall must remove the installed package');
  assert.equal(JSON.parse(read(manifestPath)).dependencies[BUNDLE], undefined, 'uninstall must drop the dependency pin');
  assert.equal(read(path.join(profile, backups(profile, 'package.json')[0])), read(manifestPath), 'restored manifest matches its backup');
  assert.equal(read(path.join(profile, backups(profile, 'cordis.patch.yml')[0])), read(patchPath), 'restored patch matches its backup');
  console.log('PASS  --uninstall restores the original profile files');
}

// 7) repeated uninstall is a no-op -----------------------------------------
{
  const result = run(INSTALL, ['--profile', profile, '--source', sourceRoot, '--uninstall']);
  assert.equal(result.status, 0, out(result));
  assert.match(out(result), /unchanged|nothing/i);
  assert.equal(read(manifestPath), ORIGINAL.get('package.json'));
  assert.equal(read(patchPath), ORIGINAL.get('cordis.patch.yml'));
  console.log('PASS  repeated uninstall changes nothing');
}

// 8) an existing bundles entry is never duplicated -------------------------
{
  const already = makeProfile(path.join(TMP, 'profile-already'), ['@deepseek-ai/dsh-base', BUNDLE]);
  const result = run(INSTALL, ['--profile', already, '--source', sourceRoot]);
  assert.equal(result.status, 0, out(result));
  const parsed = JSON.parse(read(path.join(already, 'package.json')));
  assert.equal(parsed.dsh.profile.bundles.filter((name) => name === BUNDLE).length, 1);
  assert.equal(parsed.dependencies[BUNDLE], linkSpec(sourceRoot), 'the dependency pin is still added');
  assert.equal(backups(already, 'package.json').length, 1, 'one backup: only the dependency pin was added');
  console.log('PASS  an existing bundles entry is not duplicated');
}

// 9) install refuses to ship without a successful build --------------------
{
  const api = path.join(sourceRoot, 'lib', 'api.mjs');
  const saved = read(api);
  fs.rmSync(api);
  const p2 = makeProfile(path.join(TMP, 'profile-broken'));
  const before = snapshot(p2);
  const result = run(INSTALL, ['--profile', p2, '--source', sourceRoot]);
  assert.notEqual(result.status, 0, 'install must fail when a lib source is missing');
  assert.match(out(result), /build-plugin|api\.mjs|build/i, 'failure must explain the build step');
  assert.deepEqual(snapshot(p2), before, 'a failed build must leave the profile untouched');
  assert.equal(fs.existsSync(path.join(p2, 'node_modules', BUNDLE)), false);
  write(api, saved);
  console.log('PASS  install refuses without a successful build');
}

// 10) --no-build refuses when plugin/lib was never generated ---------------
{
  const p3 = makeProfile(path.join(TMP, 'profile-nobuild'));
  const generated = path.join(sourceRoot, 'plugin', 'lib');
  const stash = path.join(TMP, 'lib-stash');
  fs.renameSync(generated, stash);
  const result = run(INSTALL, ['--profile', p3, '--source', sourceRoot, '--no-build']);
  assert.notEqual(result.status, 0, '--no-build must fail when plugin/lib is absent');
  assert.match(out(result), /build-plugin/, 'failure must point at the build command');
  assert.equal(fs.existsSync(path.join(p3, 'node_modules', BUNDLE)), false);
  fs.renameSync(stash, generated);
  console.log('PASS  --no-build refuses without plugin/lib');
}

// 11) dry-run uninstall plans the rollback and writes nothing ---------------
{
  const p4 = makeProfile(path.join(TMP, 'profile-uninstall-dry'));
  assert.equal(run(INSTALL, ['--profile', p4, '--source', sourceRoot]).status, 0);
  const installedSnapshot = snapshot(p4);
  const result = run(INSTALL, ['--profile', p4, '--source', sourceRoot, '--dry-run', '--uninstall']);
  assert.equal(result.status, 0, out(result));
  assert.match(out(result), /would package: remove/i);
  assert.match(out(result), /dry-run: nothing written/);
  assert.deepEqual(snapshot(p4), installedSnapshot, 'dry-run uninstall must not touch the profile');
  console.log('PASS  --dry-run --uninstall plans without writing');
}

// 12) an existing dependency spec is replaced in place, never duplicated -----
{
  const p5 = makeProfile(path.join(TMP, 'profile-stale-spec'));
  const staleManifest = path.join(p5, 'package.json');
  const parsedStale = JSON.parse(read(staleManifest));
  parsedStale.dependencies[BUNDLE] = 'link:E:/old/checkout/plugin';
  write(staleManifest, `${JSON.stringify(parsedStale, null, 2)}\n`);
  const result = run(INSTALL, ['--profile', p5, '--source', sourceRoot]);
  assert.equal(result.status, 0, out(result));
  const installed = JSON.parse(read(staleManifest));
  assert.equal(installed.dependencies[BUNDLE], linkSpec(sourceRoot), 'a stale spec must be rewritten to the current checkout');
  assert.equal(
    (read(staleManifest).match(/"dsh-websearch-failover"\s*:/g) ?? []).length,
    1,
    'the dependency key must appear exactly once',
  );
  assert.equal(installed.dsh.profile.bundles.filter((name) => name === BUNDLE).length, 1, 'the bundles entry stays single');
  assert.equal(
    installed.dependencies['@local/dsh-prompt-inject'],
    'link:E:/Project-hub/dsh-reverse-plugin/prompt-inject',
    'other dependencies must survive the rewrite',
  );
  console.log('PASS  a stale dependency spec is replaced in place');
}

// 13) re-install over a pnpm-style symlink updates it without damaging the linked checkout --
{
  const p6 = makeProfile(path.join(TMP, 'profile-symlink'));
  assert.equal(run(INSTALL, ['--profile', p6, '--source', sourceRoot]).status, 0);
  // Reproduce what `pnpm install` does for a `link:` dependency: node_modules/<bundle>
  // becomes a directory symlink to the checkout's plugin/ directory.
  const linked = path.join(TMP, 'linked-checkout', 'plugin');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.cpSync(path.join(sourceRoot, 'plugin'), linked, { recursive: true });
  const linkDir = path.join(p6, 'node_modules', BUNDLE);
  fs.rmSync(linkDir, { recursive: true, force: true });
  fs.symlinkSync(linked, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(fs.lstatSync(linkDir).isSymbolicLink(), true, 'fixture must be a symlink');
  // Diverge the checkout so the installer has to rewrite the installed tree.
  write(path.join(sourceRoot, 'plugin', 'index.js'), "export const inject = ['web'];\nexport function apply() {}\n// v2\n");
  const result = run(INSTALL, ['--profile', p6, '--source', sourceRoot]);
  assert.equal(result.status, 0, out(result));
  assert.match(read(path.join(linkDir, 'index.js')), /\/\/ v2/, 'the installed bundle must pick up the new file');
  assert.equal(fs.existsSync(path.join(linked, 'package.json')), true, 'the linked checkout must survive intact');
  assert.equal(fs.existsSync(path.join(linked, 'index.js')), true, 'the linked checkout must not be deleted');
  console.log('PASS  re-install over a symlinked bundle updates it without damaging the checkout');
}

// 14) a profile without a "dependencies" object is refused, not half-written --
{
  const p5 = path.join(TMP, 'profile-no-deps');
  fs.mkdirSync(p5, { recursive: true });
  write(
    path.join(p5, 'package.json'),
    `${JSON.stringify({ name: 'dsh-profile-desktop', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }, null, 2)}\n`,
  );
  write(path.join(p5, 'cordis.patch.yml'), BASE_PATCH);
  const before = snapshot(p5);
  const result = run(INSTALL, ['--profile', p5, '--source', sourceRoot]);
  assert.notEqual(result.status, 0, 'install must fail when the manifest has no dependencies object');
  assert.match(out(result), /dependencies/, 'the failure must name the missing dependencies object');
  assert.deepEqual(snapshot(p5), before, 'a refused install must leave the profile untouched');
  console.log('PASS  install refuses a profile without dependencies and writes nothing');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\ninstall contract holds');
