/** Isolated, restartable QA with synthetic accounts, rows and private photos. */
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const temp=fileURLToPath(new URL('../.workflow-evidence/special-preview-temp/',import.meta.url));
await mkdir(temp,{recursive:true});
process.env.TEMP=temp;process.env.TMP=temp;process.env.TMPDIR=temp;
process.env.PORT||='3137';
process.env.PREVIEW_SPECIAL_ACTIVITIES='1';
process.env.PREVIEW_SUPER_ADMIN='1';
process.env.PREVIEW_START_SIGNED_OUT='0';
await import('./preview-workflow.mjs');
