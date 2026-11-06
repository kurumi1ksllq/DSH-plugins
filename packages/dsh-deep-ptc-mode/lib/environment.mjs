import z from '@deepseek-ai/schemastery';
import { environmentText } from './model.mjs';
export const name = 'deep-ptc-execution-instructions';
export const inject = ['systemPrompt'];
export const Config = z.object({
  environment: z.union(['wsl', 'powershell', 'zsh', 'bash']).required(),
  wslDistribution: z.string().default(''),
});
export function apply(ctx, config) {
  ctx.systemPrompt.section({
    name: 'deep-ptc:execution-environment', order: 10190,
    text: environmentText(config.environment, config.wslDistribution),
  });
}
