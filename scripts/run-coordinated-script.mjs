import { fileURLToPath } from 'node:url';
import { runCoordinatedScript } from '../lib/maintenance/script-runner.js';

const [scriptName, ...args] = process.argv.slice(2);

await runCoordinatedScript({
  scriptName,
  args,
  root: fileURLToPath(new URL('../', import.meta.url)),
  stateDir: process.env.PLATFORM_WRITE_STATE_DIR,
  isProduction: process.env.NODE_ENV === 'production',
  execute: async (scriptUrl, scriptArgs) => {
    process.argv = [
      process.argv[0],
      fileURLToPath(scriptUrl),
      ...scriptArgs,
    ];
    await import(scriptUrl.href);
  },
});