import { Module } from '@dangao/bun-server';
import { GeneratedMediaController } from './generated-media.controller';
import { GeneratedMediaRuntimeConfig } from './generated-media-runtime.config';
import { GeneratedMediaStore } from './generated-media.store';

/**
 * 生成图本机落盘 + 匿名 GET（阶段 1）。
 */
@Module({
  controllers: [GeneratedMediaController],
  providers: [GeneratedMediaRuntimeConfig, GeneratedMediaStore],
  exports: [GeneratedMediaRuntimeConfig, GeneratedMediaStore],
})
export class GeneratedMediaModule {}
