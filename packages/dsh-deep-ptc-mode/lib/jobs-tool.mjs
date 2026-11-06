import z from '@deepseek-ai/schemastery';
import { adaptContext, registering } from './adapt.mjs';
import { applyOfficial } from './host.mjs';
import { steerableJobs, steerableTool, steeringWatch } from './reachable.mjs';

export const name = 'deep-ptc-tool-jobs';
export const inject = [];
export const Config = z.object({
  // The official job tool module and its options, as the installed PTC declaration names them.
  upstream: z.string().required(),
  options: z.any(),
  overrides: z.any(),
});

// The official job tools, with job_output waits ending when the user sends a message.
export async function apply(ctx, config) {
  const watch = steeringWatch(ctx);
  await applyOfficial(ctx, config.upstream, config.options, child => adaptContext(child, {
    tools: tools => registering(tools, definition => definition.name === 'job_output' ? steerableTool(definition) : definition),
    jobs: jobs => steerableJobs(jobs, watch),
  }), config.overrides);
}
