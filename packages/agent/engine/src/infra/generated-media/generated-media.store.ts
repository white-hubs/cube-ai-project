import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@dangao/bun-server';
import { GeneratedMediaRuntimeConfig } from './generated-media-runtime.config';

const FILE_NAME_RE = /^[a-f0-9]{32}\.png$/i;

/**
 * 将生成图以不可猜测文件名写入本机目录（阶段 1；后续可换中台 file server）。
 */
@Injectable()
export class GeneratedMediaStore {
  constructor(private readonly cfg: GeneratedMediaRuntimeConfig) {}

  async savePng(bytes: Uint8Array): Promise<{ fileName: string }> {
    await mkdir(this.cfg.storageDir, { recursive: true });
    const fileName = `${randomBytes(16).toString('hex')}.png`;
    await writeFile(join(this.cfg.storageDir, fileName), bytes);
    return { fileName };
  }

  async readPngIfPresent(fileName: string): Promise<Uint8Array | null> {
    if (!FILE_NAME_RE.test(fileName)) return null;
    const p = join(this.cfg.storageDir, fileName);
    try {
      return await readFile(p);
    } catch {
      return null;
    }
  }
}
