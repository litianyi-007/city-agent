/**
 * Fixed, trusted control-plane plugin. No source is supplied by a model, and
 * this fixed code does not read files/environment, contact networks or register
 * tools. Like other Harness plugins it is trusted host code, not a sandbox.
 *
 * Harness 0.1.5-rc.3 renders persona templates once: replacing this registered
 * variable does not rescan its value. Consequently any literal braces in the
 * original system prompt survive unchanged without reducing its system role.
 */
export const name = 'city-agent-literal-prompt';
export const inject = ['systemPrompt'];

export function apply(ctx, config) {
  if (!config || typeof config.literalPrompt !== 'string' || Object.keys(config).some(key => key !== 'literalPrompt')) {
    throw new TypeError('Literal prompt transport requires exactly one string literalPrompt.');
  }
  const literalPrompt = config.literalPrompt;
  ctx.systemPrompt.variable('city_agent_literal_prompt', () => literalPrompt);
}
