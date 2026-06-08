import { join } from 'node:path';
import { Injectable } from '@dangao/bun-server';
import { normalizeGeneratedMediaPathPrefix } from './generated-media-path';

/**
 * 本机落盘生成图：目录、对外 URL 前缀、可选绝对 URL 前缀。
 */
@Injectable()
export class GeneratedMediaRuntimeConfig {
  readonly servePathPrefix: string;
  readonly storageDir: string;
  /** 若设置，则 {@link urlForFile} 返回 `publicBaseUrl + servePathPrefix + /file` */
  readonly publicBaseUrl: string | null;

  constructor() {
    this.servePathPrefix = normalizeGeneratedMediaPathPrefix(
      process.env.AGENTIC_GENERATED_MEDIA_PATH_PREFIX,
    );
    const dirRaw = process.env.AGENTIC_GENERATED_MEDIA_DIR?.trim();
    this.storageDir = dirRaw && dirRaw.length > 0
      ? dirRaw
      : join(process.cwd(), 'var', 'agentic-generated-media');
    const base = process.env.AGENTIC_PUBLIC_BASE_URL?.trim();
    this.publicBaseUrl = base ? base.replace(/\/+$/, '') : null;
  }

  urlForFile(fileName: string): string {
    const path = `${this.servePathPrefix}/${fileName}`;
    return this.publicBaseUrl ? `${this.publicBaseUrl}${path}` : path;
  }
}
