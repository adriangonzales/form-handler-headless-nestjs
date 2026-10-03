import { registerAs } from '@nestjs/config';
import { EnvReader, readOrThrow } from './env';

export const FILESYSTEM_DISKS = ['local'] as const;

export interface StorageConfig {
  disk: (typeof FILESYSTEM_DISKS)[number];
  /** Root directory of the private local disk. */
  root: string;
}

export function readStorageConfig(r: EnvReader): StorageConfig {
  return {
    disk: r.oneOf('FILESYSTEM_DISK', FILESYSTEM_DISKS, 'local'),
    root: r.optional('STORAGE_ROOT', 'storage/app/private'),
  };
}

export const storageConfig = registerAs('storage', () =>
  readOrThrow(process.env, readStorageConfig),
);
