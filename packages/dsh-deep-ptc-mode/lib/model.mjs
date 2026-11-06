// Compose the Deep PTC agent preset from the official PTC preset that the
// installed Harness ships, replacing only the rows this plugin owns.
//
// The official declaration is the source of truth: rows it adds, renames or
// reconfigures are inherited as-is. Deep PTC then swaps in its persona, its
// selectable execution environment, its reachability guard, and wrappers for
// the official job and question tools. A change on the official side therefore
// never leaves a stale module name behind.
import snapshot from './preset.json' with { type: 'json' };
import baseSnapshot from './base-snapshot.json' with { type: 'json' };
import { normalizePreferences } from './tool-policy.mjs';

export const ENVIRONMENTS = ['auto', 'wsl', 'powershell', 'zsh', 'bash'];

export function availableEnvironments(platform) {
  return platform === 'win32' ? ['auto', 'wsl', 'powershell'] : ['auto', 'zsh', 'bash'];
}

export function resolveEnvironment(environment = 'auto', platform = process.platform) {
  if (!availableEnvironments(platform).includes(environment)) {
    throw new Error(`Execution environment ${JSON.stringify(environment)} is unavailable on ${platform}`);
  }
  return environment === 'auto'
    ? (platform === 'win32' ? 'powershell' : platform === 'darwin' ? 'zsh' : 'bash')
    : environment;
}

export function normalizeDistribution(value = '') {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('WSL distribution must be a name without control characters');
  }
  const distribution = value.trim();
  if (distribution.startsWith('-')) throw new Error('WSL distribution must not start with a dash');
  return distribution;
}

export function shellArgv(environment, spec, distribution = '', platform = process.platform) {
  if (environment === 'wsl') {
    if (platform !== 'win32') throw new Error('WSL requires a Windows host');
    const distro = normalizeDistribution(distribution);
    return ['wsl.exe', ...(distro ? ['--distribution', distro] : []),
      '--cd', spec.workdir, '--exec', 'bash', '-lc', spec.command];
  }
  if (environment === 'zsh') return [platform === 'darwin' ? '/bin/zsh' : 'zsh', '-lc', spec.command];
  throw new Error(`No mapped executor for ${environment}`);
}

export function assertExecutionPolicy(environment, policy) {
  if (environment === 'wsl' && policy?.mode !== 'danger-full-access') {
    throw new Error('WSL execution is not supported under a confined Windows sandbox. Select PowerShell for confined work, or use the host\'s existing approval flow for this exact command. No command was executed.');
  }
}

export function environmentText(environment, distribution = '') {
  const descriptions = {
    wsl: `Execution environment: WSL Bash${distribution ? ` (${distribution})` : ' (Windows default distribution)'}. The bash tool runs POSIX source via wsl.exe and bash -lc. File tools and the tool workdir use Windows host paths; Linux paths belong inside command source. WSL is available only in danger-full-access; a confined call fails without execution. Never silently fall back to PowerShell or another distribution.`,
    powershell: 'Execution environment: native Windows PowerShell. Use the pwsh tool and PowerShell syntax, native Windows paths and $env:NAME. This selection takes precedence over older workspace guidance that assumed WSL. The configured sandbox and approval policy still apply.',
    zsh: 'Execution environment: native Zsh. Use the zsh tool with Zsh/POSIX command source. On macOS the executor is /bin/zsh -lc; elsewhere zsh must be installed. File tools and workdir use native host paths. The configured sandbox and approval policy still apply.',
    bash: 'Execution environment: native Bash on macOS/Linux. Use the bash tool with Bash/POSIX command source and native host paths. This is not WSL. The configured sandbox and approval policy still apply.',
  };
  if (!descriptions[environment]) throw new Error(`Unknown environment ${environment}`);
  return descriptions[environment];
}

export const DEFAULT_FOREGROUND_SECONDS = 30;
export const QUESTION_SECONDS = 120;

export function normalizeForegroundSeconds(value = DEFAULT_FOREGROUND_SECONDS) {
  if (!Number.isInteger(value) || value < 5 || value > 600) throw new Error('Foreground wait must be a whole number of seconds from 5 to 600');
  return value;
}

/**
 * Lookup hints for the official rows Deep PTC replaces with its execution group. Hints only find
 * rows; the modules Deep PTC loads are always the ones the official rows (or the base declaration)
 * name, so a renamed or replaced official module is followed rather than hard-coded.
 */
export const SHELL_TOOLS = {
  bash: { ids: ['tool-bash'], names: ['@deepseek-ai/dsh-tool-bash'] },
  pwsh: { ids: ['tool-pwsh'], names: ['@deepseek-ai/dsh-tool-pwsh'] },
};
const SHELL_EXECUTOR_NAMES = [
  '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-pwsh-local',
  '@deepseek-ai/dsh-pwsh-sandbox',
];
export const SHELL_ROWS = {
  ids: [...SHELL_TOOLS.bash.ids, ...SHELL_TOOLS.pwsh.ids],
  names: [...SHELL_TOOLS.bash.names, ...SHELL_TOOLS.pwsh.names, ...SHELL_EXECUTOR_NAMES],
};

/** Lookup hints for the official rows Deep PTC keeps but wraps, keyed by row id. */
export const WRAPPED_ROWS = {
  'tool-jobs': '@deepseek-ai/dsh-tool-jobs',
  'tool-ask-user': '@deepseek-ai/dsh-tool-ask-user',
};

/** Fallback executor declaration, used only when the installed base declaration cannot be read. */
export const BASE_SNAPSHOT = baseSnapshot;

const PERSONA_ROW = { ids: ['persona'], names: ['@deepseek-ai/dsh-persona'] };
const WRAP_TARGETS = [
  {
    key: 'tool-jobs',
    replacement: 'dsh-deep-ptc-mode/jobs-tool',
    options: milliseconds => ({ waitTimeoutMs: milliseconds, maxWaitTimeoutMs: milliseconds }),
  },
  {
    key: 'tool-ask-user',
    replacement: 'dsh-deep-ptc-mode/ask-user',
    options: () => ({ mode: 'timed', timeout: QUESTION_SECONDS }),
  },
];

/** Identity and display text Deep PTC publishes, independent of the official preset. */
export const PRESET_META = {
  id: 'deep-ptc',
  name: typeof snapshot.name === 'string' && snapshot.name.length > 0 ? snapshot.name : '深度PTC模式',
  order: typeof snapshot.order === 'number' ? snapshot.order : 5,
  description: typeof snapshot.description === 'string' ? snapshot.description : '',
};

/** Persona text owned by this plugin, read from the bundled snapshot. */
export function personaFrom(template = snapshot) {
  const rows = Array.isArray(template?.plugins) ? template.plugins : [];
  const row = findRow(rows, PERSONA_ROW);
  const config = row?.config;
  if (!config || typeof config.prefix !== 'string' || typeof config.suffix !== 'string') {
    throw new Error('bundled snapshot carries no Deep PTC persona');
  }
  return { prefix: config.prefix, suffix: config.suffix };
}

/** Visit every row depth-first, including rows nested in group configurations. */
export function walkRows(rows, visit) {
  if (!Array.isArray(rows)) return;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== 'object') continue;
    visit(row, rows, index);
    if (row.group === true && Array.isArray(row.config)) walkRows(row.config, visit);
  }
}

/** Whether a row is one of the official shell/executor rows Deep PTC replaces. */
export function isShellRow(row) {
  return row.group !== true && (SHELL_ROWS.names.includes(row.name) || SHELL_ROWS.ids.includes(row.id));
}

function findRow(rows, { ids = [], names = [] }) {
  let found;
  walkRows(rows, row => {
    if (found !== undefined) return;
    if (names.includes(row.name) || ids.includes(row.id)) found = row;
  });
  return found;
}

function rowIds(plugins, into = new Set()) {
  walkRows(plugins, row => {
    if (typeof row.id === 'string') into.add(row.id);
  });
  return into;
}

function uniqueRowId(plugins, preferred) {
  const taken = rowIds(plugins);
  if (!taken.has(preferred)) return preferred;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Compose the Deep PTC preset from an official PTC declaration.
 * @param upstream - Official preset configuration (`{ id, order, plugins }`).
 * @param options - `environment`, `wslDistribution`, `foregroundSeconds`.
 * @param platform - Host platform whose environment choices apply.
 * @returns The Deep PTC preset plus a report of what was replaced, wrapped or skipped.
 */
export function deriveDeepPtc(upstream, options = {}, platform = process.platform) {
  if (!upstream || !Array.isArray(upstream.plugins) || upstream.plugins.length === 0) {
    throw new Error('official PTC preset carries no plugin rows');
  }
  for (const row of upstream.plugins) {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string') {
      throw new Error('official PTC preset has a malformed plugin row');
    }
  }

  const environment = resolveEnvironment(options.environment, platform);
  const distribution = normalizeDistribution(options.wslDistribution);
  const foregroundSeconds = normalizeForegroundSeconds(options.foregroundSeconds);
  const foregroundMs = foregroundSeconds * 1000;
  const toolPreferences = normalizePreferences(options.toolPreferences);
  const plugins = structuredClone(upstream.plugins);
  const report = {
    upstreamId: typeof upstream.id === 'string' ? upstream.id : null,
    upstreamRows: plugins.length,
    persona: 'missing',
    replacedShellRows: [],
    wrapped: [],
    skipped: [],
  };

  // Persona: keep the row and any official fields, replace only the text.
  const personaText = personaFrom();
  const persona = findRow(plugins, PERSONA_ROW);
  if (persona === undefined) {
    plugins.unshift({ id: uniqueRowId(plugins, 'persona'), name: '@deepseek-ai/dsh-persona', config: { ...personaText } });
    report.persona = 'inserted';
  } else {
    persona.config = { ...(persona.config ?? {}), ...personaText };
    report.persona = 'replaced';
  }

  // Safe mode is the official composition plus the persona, for a host where the rest cannot mount.
  if (options.safeMode === true) {
    report.environment = 'official';
    report.skipped.push('safe mode: official composition with the Deep PTC persona');
    return { preset: { ...upstream, id: PRESET_META.id, name: PRESET_META.name, order: PRESET_META.order,
      description: `${PRESET_META.description} 当前为安全模式`, plugins }, report };
  }

  // Execution environment: replace the official shell rows (wherever the official preset nests them)
  // with the selectable execution group in the same place. The group runs the official shell tool
  // and executor the installed Harness names; when they cannot be mapped, the official rows stay.
  const kind = environment === 'powershell' ? 'pwsh' : 'bash';
  const executors = { ...BASE_SNAPSHOT, ...(options.executors ?? {}) };
  const tool = findRow(plugins, SHELL_TOOLS[kind]);
  const official = executors[kind];
  const mapped = environment === 'wsl' || environment === 'zsh';
  const unusable = tool === undefined ? `the official PTC preset has no ${kind} tool row`
    : typeof official?.name !== 'string' ? `the installed Harness declares no ${kind} executor`
    : mapped && options.mappedExecutor === false ? `the official bash executor cannot be extended for ${environment}`
    : undefined;
  report.environment = unusable === undefined ? environment : 'official';
  let anchorSiblings = plugins;
  let anchorIndex;
  const rows = [];
  if (unusable !== undefined) {
    report.skipped.push(`execution environment ${environment} (${unusable}; official shell rows kept)`);
    const topLevelPersona = plugins.findIndex(row => row && row.group !== true
      && (PERSONA_ROW.names.includes(row.name) || PERSONA_ROW.ids.includes(row.id)));
    anchorIndex = topLevelPersona + 1;
  } else {
    const removed = [];
    walkRows(plugins, (row, siblings, index) => {
      if (isShellRow(row)) removed.push({ row, siblings, index });
    });
    report.replacedShellRows = removed.map(({ row }) => `${row.id ?? '?'} (${row.name})`);
    anchorSiblings = removed[0].siblings;
    const bySiblings = new Map();
    for (const { siblings, index } of removed) {
      if (!bySiblings.has(siblings)) bySiblings.set(siblings, []);
      bySiblings.get(siblings).push(index);
    }
    anchorIndex = Math.min(...bySiblings.get(anchorSiblings));
    for (const [siblings, indexes] of bySiblings) {
      for (const index of [...indexes].sort((left, right) => right - left)) siblings.splice(index, 1);
    }
    // With background jobs available, the executor timeout only decides when a foreground command
    // moves to the background; the official tools run such commands with onExpiry: none.
    const executorOptions = { ...(official.config ?? {}), timeoutMs: foregroundMs, maxTimeoutMs: foregroundMs };
    const executor = mapped
      ? { id: 'executor', name: 'dsh-deep-ptc-mode/executor',
        config: { environment, wslDistribution: distribution, base: official.name, options: executorOptions } }
      : { id: 'executor', name: official.name, config: executorOptions };
    const terminal = {
      id: environment === 'zsh' ? 'tool-zsh' : tool.id ?? `tool-${kind}`,
      name: 'dsh-deep-ptc-mode/terminal',
      config: {
        upstream: tool.name,
        ...tool.config === undefined ? {} : { options: tool.config },
        ...environment === 'zsh' ? { dialect: 'zsh' } : {},
      },
    };
    rows.push({
      id: uniqueRowId(plugins, 'execution'), name: 'cordis:group', group: true, isolate: { shell: true },
      config: [executor, terminal, { id: 'execution-instructions', name: 'dsh-deep-ptc-mode/environment',
        config: { environment, wslDistribution: distribution } }],
    });
  }
  rows.push({
    id: uniqueRowId([...plugins, ...rows], 'reachability'),
    name: 'dsh-deep-ptc-mode/guard', config: { foregroundSeconds },
  });
  anchorSiblings.splice(anchorIndex, 0, ...rows);

  // Wrapped tools: the wrapper loads the module the official row names, with the official options
  // plus the Deep PTC wait behaviour.
  for (const target of WRAP_TARGETS) {
    const row = findRow(plugins, { ids: [target.key], names: [WRAPPED_ROWS[target.key]] });
    if (row === undefined) {
      report.skipped.push(`${target.key} (no official row)`);
      continue;
    }
    const upstreamName = row.name;
    row.name = target.replacement;
    row.config = { upstream: upstreamName, ...row.config === undefined ? {} : { options: row.config }, overrides: target.options(foregroundMs) };
    report.wrapped.push(`${target.key} (${upstreamName})`);
  }

  // Official rows stay exactly as declared. Tool discovery learns their tools from these module names.
  const officialModules = [];
  walkRows(upstream.plugins, row => {
    if (row.group === true || typeof row.name !== 'string' || row.disabled === true) return;
    officialModules.push({ name: row.name, ...typeof row.config?.toolName === 'string' ? { toolName: row.config.toolName } : {} });
  });
  plugins.push({
    id: uniqueRowId(plugins, 'tool-compatibility'), name: 'dsh-deep-ptc-mode/tool-compatibility',
    config: { enabled: options.toolCompatibility !== false, preferences: toolPreferences,
      compact: options.compactToolCatalog !== false, officialModules,
      sdkProvider: findRow(upstream.plugins, {ids:['tool-executor-ptc'],names:['@deepseek-ai/dsh-tool-executor-ptc']})?.name ?? '@deepseek-ai/dsh-tool-executor-ptc',
      skillProvider: findRow(upstream.plugins, {ids:['tool-skill'],names:['@deepseek-ai/dsh-tool-skill']})?.name ?? '@deepseek-ai/dsh-tool-skill' },
  });

  const description = `${PRESET_META.description} 当前环境：${environment}${environment === 'wsl' && distribution ? ` (${distribution})` : ''}`;
  return {
    preset: {
      ...upstream,
      id: PRESET_META.id,
      name: PRESET_META.name,
      order: PRESET_META.order,
      description,
      plugins,
    },
    report,
  };
}

/** Backwards-compatible helper: the derived preset without the report. */
export function configuredPreset(template, options, platform = process.platform) {
  return deriveDeepPtc(template, options, platform).preset;
}
