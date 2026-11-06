import z from '@deepseek-ai/schemastery';
import { importHost, pluginOf } from './host.mjs';
import { assertExecutionPolicy, shellArgv } from './model.mjs';

export const name = 'deep-ptc-mapped-executor';
export const inject = [];
export const Config = z.object({
  environment: z.union(['wsl', 'zsh']).required(),
  wslDistribution: z.string().default(''),
  // The official bash executor module and its options, as the installed base declaration names them.
  base: z.string().required(),
  options: z.any(),
});

// Extend the official bash executor: its process handles, output retention, cancellation, jobs,
// sandbox and Config stay official; only the argv that starts the shell changes.
export function mappedExecutor(Base, environment, distribution = '') {
  return class MappedShellExecutor extends Base {
    async execute(spec) {
      assertExecutionPolicy(environment, spec.sandboxPolicy);
      if (spec.sandboxPolicy.mode !== 'danger-full-access') return super.execute(spec);
      const process = await super.executeArgv(spec, shellArgv(environment, spec, distribution));
      return Base.decorateResult(process, result => ({
        ...result, sandbox: { mode: spec.sandboxPolicy.mode, denied: false },
      }));
    }

    confine(command, policy, signal) {
      assertExecutionPolicy(environment, policy);
      return this.ctx.sandbox.confine(shellArgv(environment,
        { command, workdir: policy.workspaceRoot }, distribution), policy, signal);
    }
  };
}

export async function apply(ctx, config) {
  const Base = pluginOf(await importHost(config.base));
  if (typeof Base !== 'function' || typeof Base.decorateResult !== 'function' || typeof Base.prototype.executeArgv !== 'function')
    throw new Error(`${config.base} no longer exposes the executor API Deep PTC extends; choose PowerShell or native Bash`);
  ctx.plugin(mappedExecutor(Base, config.environment, config.wslDistribution), config.options);
}
