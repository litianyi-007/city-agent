/** Trusted manual installation text only; never executed by the public portal. */
export const REVIEWER_SOFTWARE_REQUIREMENTS = 'Node.js >=22.19 (validated 22.22.3), Git, npm, a supported Chromium browser environment and an available local port 4420. Installation downloads dependencies/browser; fixed Mock review needs no model Key. Real requests require your own local model/JeV configuration, declared prices, one-use consent and a finite budget.';
export const REVIEWER_CAMERA_PREPARATION_COMMANDS = 'npx tsx scripts/prepare-camera-assets.ts\nnpx tsx scripts/prepare-camera-assets.ts --verify';
export function reviewerInstallCommands(commit: string): string {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Reviewer installation requires the immutable complete report commit');
  return `(\nset -eu\nif [ -e city-agent-production-review ] || [ -L city-agent-production-review ]; then\n  echo 'Install directory already exists; use a fresh parent directory.'\n  exit 1\nfi\ngit clone --branch feature/autonomous-production --single-branch https://github.com/litianyi-007/city-agent.git city-agent-production-review\ncd city-agent-production-review\ngit checkout --detach ${commit}\nnpm ci --engine-strict\nnpx playwright install chromium\nnpm run build\nnpm start\n)\n# Open manually: http://127.0.0.1:4420/#production`;
}
