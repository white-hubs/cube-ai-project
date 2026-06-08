import { SfidService } from './sfid.service';

/**
 * 进程内共享 Snowflake 生成器。
 * Bun 子进程场景下部分 `@Inject(SfidService)` 元数据不完整会导致注入失败；
 * Session / Outbox 等关键路径显式引用此单例以保证 `next()` 可用。
 */
export const sharedSfidService = new SfidService();
