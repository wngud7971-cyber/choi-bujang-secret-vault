import { runReadChecks } from './submission-read-check.mjs';

export async function runAttackChecks(config, options = {}) {
  if (config.step >= 11) return runReadChecks(config, options);
  // Earlier-stage local regression never loads in the stage 11 submission path.
  const legacy = await import('./legacy-attack-check.mjs');
  return legacy.runAttackChecks(config, options);
}
