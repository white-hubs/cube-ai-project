import { Module } from '@dangao/bun-server';
import { DescriptorRegistryService } from './descriptor-registry.service';
import { DescriptorLoader } from './descriptor-loader';
import { SkillRegistryService } from './skill-registry.service';
import {
  TOOL_EFFECTIVE_VERSION_SOURCE_TOKEN,
  toolEffectiveVersionProviderFactory,
} from './tool-effective-version.provider';

/**
 * Descriptor BC Module。
 *
 * 权威来源：docs/detailed-design/07-tools/registration-lifecycle.md §2
 * DI token 规范：shared-context §9.3（Symbol.for('agentic.<bc>.<name>')）
 *
 * Phase 3（P3-11）：Nacos 加载 + Tool 生效版本映射。
 */
@Module({
  providers: [
    {
      provide: TOOL_EFFECTIVE_VERSION_SOURCE_TOKEN,
      useFactory: toolEffectiveVersionProviderFactory,
    },
    DescriptorRegistryService,
    SkillRegistryService,
    DescriptorLoader,
  ],
  exports: [DescriptorRegistryService, SkillRegistryService, DescriptorLoader],
})
export class DescriptorModule {}
