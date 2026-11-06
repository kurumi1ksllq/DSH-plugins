import z from '@deepseek-ai/schemastery';
import { reachabilityGuard, reachabilityText } from './rules.mjs';
import { failOpen } from './tool-policy.mjs';

export const name = 'deep-ptc-reachability-guard';
export const inject = ['tools', 'systemPrompt'];
export const Config = z.object({
  foregroundSeconds: z.number().min(5).max(600).default(30),
  maxQuestionSeconds: z.number().min(10).max(3600).default(300),
  maxPollsPerProgram: z.number().min(1).max(100).default(3),
});

export function apply(ctx, config) {
  ctx.tools.guard(failOpen(ctx, 'reachability guard', reachabilityGuard(config, () => ctx.get('jobs'), () => ctx.get('ptcRuntime')?.language)));
  ctx.systemPrompt.section({ name: 'deep-ptc:reachability', order: 10195, text: reachabilityText(config) });
}
