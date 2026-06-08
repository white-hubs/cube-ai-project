import 'reflect-metadata';
import { Controller, GET, contextStore, type Context } from '@dangao/bun-server';
import { AgenticEngineError } from '../errors/agentic-error';
import { normalizeGeneratedMediaPathPrefix } from './generated-media-path';
import { GeneratedMediaStore } from './generated-media.store';

const SERVE_PREFIX = normalizeGeneratedMediaPathPrefix(process.env.AGENTIC_GENERATED_MEDIA_PATH_PREFIX);

/**
 * 匿名 GET 本机落盘的生成 PNG（阶段 1）。
 *
 * 挂载路径与 {@link normalizeGeneratedMediaPathPrefix} 一致；进程启动时固定。
 */
@Controller(SERVE_PREFIX)
export class GeneratedMediaController {
  constructor(private readonly store: GeneratedMediaStore) {}

  @GET('/:fileName')
  async getFile(): Promise<Response> {
    const ctx = contextStore.getStore() as Context | undefined;
    if (!ctx) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Request Context missing');
    }
    const fileName = ctx.getParam('fileName') ?? '';
    const body = await this.store.readPngIfPresent(fileName);
    if (!body) {
      ctx.setStatus(404);
      return new Response('Not Found', { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
}
