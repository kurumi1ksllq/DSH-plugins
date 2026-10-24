#!/usr/bin/env node
// CLI over lib/core.mjs.
//   node search.mjs "中文/english query" [--limit 8] [--json] [--force]
//   node search.mjs --probe            # test every provider once
//   node search.mjs --list             # providers + cooldown status
import {
  defaultConfigPath,
  defaultStatePath,
  formatResult,
  loadConfig,
  probeAll,
  readState,
  search,
  SearchError,
} from './lib/core.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--') && token !== '-n') {
      args._.push(token);
      continue;
    }
    const [flag, inline] = token.split('=');
    const name = flag.replace(/^-+/, '');
    if (name === 'n') {
      args.limit = Number(argv[++i]);
      continue;
    }
    const value = inline ?? (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    args[name] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function usage() {
  console.log(`websearch-failover — ordered multi-provider search

  node search.mjs "query" [--limit 8] [--json] [--force] [--config PATH] [--timeout MS]
  node search.mjs --probe [--query "..."]      test every provider once (no state writes)
  node search.mjs --list                       show providers and cooldown state

config: ${defaultConfigPath()}
state:  ${defaultStatePath()}`);
}

async function main() {
  if (args.help || args.h) return usage();
  const configPath = typeof args.config === 'string' ? args.config : defaultConfigPath();
  const config = loadConfig(configPath);
  const statePath = typeof args.state === 'string' ? args.state : defaultStatePath();

  if (args.list === true) {
    const state = readState(statePath);
    const now = Date.now();
    for (const provider of config.providers) {
      const cooldown = state.providers[provider.id];
      const status = cooldown && cooldown.until > now ? `COOLDOWN until ${new Date(cooldown.until).toISOString()} (${cooldown.reason})` : 'ready';
      console.log(`${provider.id.padEnd(12)} ${provider.kind.padEnd(10)} ${status}`);
    }
    return;
  }

  if (args.probe === true) {
    const query = typeof args.query === 'string' ? args.query : 'deepseek harness web search';
    const results = await probeAll({ config, query, limit: 3 });
    if (args.json === true) {
      console.log(JSON.stringify({ query, results }, null, 2));
      return;
    }
    for (const r of results) {
      const verdict = r.ok ? `OK   ${r.count} results / ${r.elapsedMs}ms` : `FAIL ${r.failureKind ?? r.code ?? ''} ${r.message ?? ''}`;
      console.log(`${r.provider.padEnd(12)} ${r.kind.padEnd(10)} ${verdict}`);
      for (const sample of r.sample ?? []) console.log(`             · ${sample}`);
    }
    return;
  }

  const query = args._.join(' ').trim();
  if (query.length === 0) {
    usage();
    process.exitCode = 2;
    return;
  }

  try {
    const result = await search({
      query,
      limit: args.limit,
      config,
      statePath,
      force: args.force === true,
      ...(args.timeout ? { timeoutMs: Number(args.timeout) } : {}),
    });
    console.log(args.json === true ? JSON.stringify(result, null, 2) : formatResult(result));
  } catch (error) {
    if (error instanceof SearchError && error.code === 'ALL_FAILED') {
      console.error(`FAILED: ${error.message}`);
      if (args.json === true) console.log(JSON.stringify({ query, error: error.message, attempts: error.attempts }, null, 2));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`error: ${error?.message ?? error}`);
  process.exitCode = 1;
});
