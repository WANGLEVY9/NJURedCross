import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const executeFile = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

const names = [
  'apply-account-schema.mjs',
  'apply-event-schema.mjs',
  'apply-notice-schema.mjs',
  'apply-state-schema.mjs',
  'apply-workflow-schema.mjs',
  'clean-test-rows.mjs',
  'extend-registration-profile-schema.mjs',
  'extend-volunteer-profile-schema.mjs',
  'migrate-private-identity.mjs',
  'retire-business-identity.mjs',
  'set-account-role.mjs',
  'smoke-workflow-test-base.mjs',
  'smoke-material-recovery-test-base.mjs',
];

for (const name of names) {
  test(`direct write is refused before script execution: ${name}`, async () => {
    const url = new URL(`../scripts/${name}`, import.meta.url);
    const source = (await readFile(url, 'utf8')).replace(/\r\n/g, '\n');

    const guard = name === 'smoke-workflow-test-base.mjs'
      ? 'assertCoordinatedMaintenance();'
      : "assertCoordinatedMaintenance({ write: process.argv.includes('--apply') });";

    assert.ok(source.startsWith(
      "import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';\n"
        + guard + '\n',
    ), '拦截检查必须位于脚本正文之前');

    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(SEATABLE_|SMTP_|NJUBOX_|PLATFORM_|NODE_OPTIONS$)/i.test(key)) {
        delete env[key];
      }
    }
    env.SEATABLE_SERVER_URL = 'http://127.0.0.1:9';
    env.NODE_ENV = 'development';

    const args = name === 'smoke-workflow-test-base.mjs'
      ? []
      : ['--apply'];

    await assert.rejects(
      executeFile(process.execPath, [fileURLToPath(url), ...args], {
        cwd: root,
        env,
        timeout: 5000,
        maxBuffer: 64 * 1024,
      }),
      error => error.code === 1
        && /写入维护脚本必须通过 scripts\/run-coordinated-script\.mjs 运行/.test(
          error.stderr,
        ),
    );
  });
}

test('npm maintenance commands use the coordinated entry', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  ));

  for (const [name, command] of Object.entries(packageJson.scripts)) {
    for (const scriptName of names) {
      assert.ok(
        !command.includes(`scripts/${scriptName}`),
        `${name} 不能直接运行维护脚本`,
      );
    }
  }

  assert.match(
    packageJson.scripts['state:purge-preview'],
    /run-coordinated-script\.mjs clean-test-rows\.mjs --purge$/,
  );
});