import z from '@deepseek-ai/schemastery';
import snapshot from './preset.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizePreferences } from './tool-policy.mjs';
import { availableEnvironments, BASE_SNAPSHOT, DEFAULT_FOREGROUND_SECONDS, deriveDeepPtc, normalizeDistribution, resolveEnvironment } from './model.mjs';
import { BASE_DECLARATION_SPECIFIER, loadOfficialPreset, loadCurrentPreset, officialPresetUrl, parseOfficialExecutors } from './upstream.mjs';
import { importHost, pluginOf, resolveHost } from './host.mjs';
import { presetLifecycle } from './lifecycle.mjs';

export const name = 'deep-ptc-settings';
export const inject = ['agentPresets'];
export const Config = z.object({
  environment: z.union(availableEnvironments(process.platform)).default('auto').volatile(),
  wslDistribution: z.string().pattern(/^(?!\s*-)[^\u0000-\u001f\u007f]*$/u).default('').volatile(),
  foregroundSeconds: z.number().step(1).min(5).max(600).default(DEFAULT_FOREGROUND_SECONDS).volatile(),
  toolCompatibility: z.boolean().default(true).volatile(),
  toolPreferences: z.any().default([]).volatile(),
  compactToolCatalog: z.boolean().default(true).volatile(),
  hostPlatform: z.const(process.platform).default(process.platform).volatile(),
});

// Tool preferences are advice for the model, so a malformed list must not cost the preset.
function preferencesOf(ctx, config) {
  try {
    return normalizePreferences(config.toolPreferences.get());
  } catch (error) {
    ctx.logger.warn('Deep PTC: ignoring toolPreferences (%s)', error.message);
    return [];
  }
}

function settingsOf(ctx, config) {
  return {
    environment: config.environment.get(),
    wslDistribution: normalizeDistribution(config.wslDistribution.get()),
    foregroundSeconds: config.foregroundSeconds.get(),
    toolCompatibility: config.toolCompatibility.get(),
    toolPreferences: preferencesOf(ctx, config),
    compactToolCatalog: config.compactToolCatalog.get(),
  };
}

// The shell executors the installed Harness declares in its base deployment, by kind.
function officialExecutors(ctx) {
  try {
    const url = resolveHost(BASE_DECLARATION_SPECIFIER);
    if (url === undefined) throw new Error(`cannot resolve ${BASE_DECLARATION_SPECIFIER}`);
    const executors = parseOfficialExecutors(readFileSync(fileURLToPath(url), 'utf8'));
    for (const kind of ['bash', 'pwsh']) if (executors[kind] === undefined)
      ctx.logger.warn('Deep PTC: %s declares no %s executor; using the bundled snapshot entry', url, kind);
    return { ...BASE_SNAPSHOT, ...executors };
  } catch (error) {
    ctx.logger.warn('Deep PTC: official executors unavailable (%s); using the bundled snapshot', error.message);
    return BASE_SNAPSHOT;
  }
}

// WSL and Zsh extend the official bash executor class. Probe it before choosing that path so an
// incompatible Harness falls back to the official shell rows instead of a preset that cannot mount.
async function canExtend(ctx, executor) {
  try {
    const Base = pluginOf(await importHost(executor.name));
    if (typeof Base === 'function' && typeof Base.decorateResult === 'function'
      && typeof Base.prototype.executeArgv === 'function') return true;
    ctx.logger.warn('Deep PTC: %s no longer exposes the executor API WSL/Zsh extend', executor.name);
  } catch (error) {
    ctx.logger.warn('Deep PTC: cannot load %s (%s)', executor.name, error.message);
  }
  return false;
}

// Derive Deep PTC from the PTC preset the installed Harness declares, so an
// official change is inherited instead of leaving a stale frozen row behind.
// The bundled snapshot is only a fallback when the installed declaration
// cannot be read or cannot be composed.
async function buildPreset(ctx, config, safeMode) {
  const settings = { ...settingsOf(ctx, config), safeMode };
  const executors = officialExecutors(ctx);
  const environment = resolveEnvironment(settings.environment);
  if (environment === 'wsl' || environment === 'zsh') settings.mappedExecutor = await canExtend(ctx, executors.bash);
  settings.executors = executors;
  let upstream = snapshot;
  let source = 'bundled snapshot';
  try {
    const official = await loadCurrentPreset(ctx.agentPresets);
    upstream = official.preset;
    source = official.source;
  } catch (error) {
    ctx.logger.warn('Deep PTC: official PTC preset unavailable (%s); deriving from the bundled snapshot', error.message);
  }
  try {
    const { preset, report } = deriveDeepPtc(upstream, settings);
    ctx.logger.info(
      'Deep PTC preset derived from %s: %d official rows; persona %s; environment %s; shell rows [%s]; wrapped [%s]; skipped [%s]',
      source, report.upstreamRows, report.persona, report.environment,
      report.replacedShellRows.join('; ') || '-', report.wrapped.join(', ') || '-', report.skipped.join('; ') || '-',
    );
    return preset;
  } catch (error) {
    if (upstream === snapshot) throw error;
    ctx.logger.warn('Deep PTC: deriving from %s failed (%s); deriving from the bundled snapshot', source, error.message);
    return deriveDeepPtc(snapshot, settings).preset;
  }
}

export async function apply(ctx, config) {
  let safeMode = false;
  const lifecycle = presetLifecycle(
    definition => ctx.agentPresets.register(definition),
    () => buildPreset(ctx, config, safeMode),
    error => ctx.logger.error('Deep PTC environment update failed: %s', error.message),
  );
  ctx.effect(() => () => lifecycle.dispose());
  // A preset the host refuses to mount would leave its sessions unusable, so fall back to the official
  // composition with the persona. Not awaited: reading the diagnosis waits for the host tree.
  const verify = async () => {
    const row = (await ctx.agentPresets.compositionInventory?.())?.find(candidate => candidate.id === 'deep-ptc');
    if (safeMode || !row?.broken) return;
    ctx.logger.warn('Deep PTC: preset cannot mount (%s); using safe mode', row.broken);
    safeMode = true;
    await lifecycle.refresh();
  };
  const refreshed = () => lifecycle.refresh().then(() => { void verify().catch(() => {}); });
  // Read the installed declarations, not fixture versions. Refresh only when our settings or
  // upstream declaration bytes change. Existing sessions keep their leased preset generation.
  const signature = async () => {
    const read = url => {try{return readFileSync(fileURLToPath(url),'utf8');}catch{return '';}};
    let runtime='';try{runtime=JSON.stringify(await ctx.agentPresets.readDocument?.('ptc'));}catch{}
    return JSON.stringify(settingsOf(ctx,config))+'\0'+runtime+'\0'+read(officialPresetUrl())+'\0'+read(resolveHost(BASE_DECLARATION_SPECIFIER));
  };
  let previous=await signature(), detecting=false, active=true;
  const detect = async () => {
    if(detecting||!active)return;detecting=true;
    try {const current=await signature();if(!active||current===previous)return;previous=current;safeMode=false;await refreshed().catch(()=>{});}catch(error){ctx.logger.warn('Deep PTC: upstream detection failed (%s); retaining the active preset',error.message);}finally{detecting=false;}
  };
  ctx.on('loader/volatile-update', detect);
  const upstreamWatch=setInterval(detect,5000);upstreamWatch.unref?.();
  ctx.effect(()=>()=>{active=false;clearInterval(upstreamWatch);});
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  // A failure to publish the preset is reported above; it must not take the
  // settings service (or the rest of the profile) down with it.
  await refreshed().catch(() => {});
}
