import z from '@deepseek-ai/schemastery';
import { environmentText, ENVIRONMENTS } from './model.mjs';
export const name = 'deep-ptc-execution-instructions';
export const inject = ['systemPrompt'];
export const Config = z.object({
  // T4.ptc: the union tracks ENVIRONMENTS — it used to omit both `auto` (the
  // card's default!) and `git-bash`, so saving either was schema-rejected.
  environment: z.union([...ENVIRONMENTS]).required(),
  wslDistribution: z.string().default(''),
});
export function apply(ctx, config) {
  ctx.systemPrompt.section({
    name: 'deep-ptc:execution-environment', order: 10190,
    text: environmentText(config.environment, config.wslDistribution),
  });
}
