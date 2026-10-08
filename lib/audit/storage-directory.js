import { lstat, realpath } from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

function unavailable() {
  return Object.assign(
    new Error('审计私有状态目录无法安全确认，已停止启动。'),
    { code: 'audit_storage_directory_unavailable' },
  );
}

function isWithin(parent, target) {
  const location = relative(parent, target);
  return location === ''
    || (!isAbsolute(location)
      && location !== '..'
      && !location.startsWith(`..${sep}`));
}

/** Inspect existing ancestors without creating or changing directories. */
export async function validateAuditStorageDirectory(config, publicDir) {
  if (config === null) return;

  if (
    !config
    || typeof config.directory !== 'string'
    || !isAbsolute(config.directory)
    || typeof publicDir !== 'string'
    || !publicDir
  ) {
    throw unavailable();
  }

  try {
    const directory = resolve(config.directory);
    let current = directory;
    let existingAncestor = null;

    for (;;) {
      let info;

      try {
        info = await lstat(current);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      if (info) {
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw unavailable();
        }
        if (existingAncestor === null) existingAncestor = current;
      }

      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    if (existingAncestor === null) throw unavailable();

    const physicalAncestor = await realpath(existingAncestor);
    const physicalDirectory = join(
      physicalAncestor,
      relative(existingAncestor, directory),
    );
    const physicalPublic = await realpath(resolve(publicDir));

    if (isWithin(physicalPublic, physicalDirectory)) {
      throw unavailable();
    }
    const databaseNames = [
      'material-receipts.sqlite',
      'write-lock.sqlite',
      'mail-deliveries.sqlite',
      'mail-retries.sqlite',
      'audit-reconciliation.sqlite',
    ];

    for (const name of databaseNames) {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        let info;

        try {
          info = await lstat(join(directory, name + suffix));
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }

        if (
          !info.isFile()
          || info.isSymbolicLink()
          || info.nlink !== 1
        ) {
          throw unavailable();
        }
      }
    }
  } catch {
    throw unavailable();
  }
}