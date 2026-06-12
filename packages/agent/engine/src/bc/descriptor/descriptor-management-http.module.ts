/**
 * DescriptorManagementHttpModule —— agent 管理面 HTTP 装配（ADR-0016 §8）。
 *
 * 复用 engine 同一 MySQL pool（`MYSQL_POOL_TOKEN` = `agentic.infra.mysql`，与 session/turn 同库）。
 * 无 MySQL 连接时仍可构造（repository 延迟到方法调用才校验 pool），不阻塞无库的 dev 启动。
 */
import { Module, type Container } from '@dangao/bun-server';
import type { Pool } from 'mysql2/promise';
import { MYSQL_POOL_TOKEN } from '../../infra/mysql/mysql.tokens';
import { sharedSfidService } from '../../infra/sfid/shared-sfid';
import { DescriptorManagementController } from './descriptor-management.controller';
import { DescriptorManagementService } from './descriptor-management.service';
import { TenantDescriptorRepositoryImpl } from './tenant-descriptor.repository';

@Module({
  controllers: [DescriptorManagementController],
  providers: [
    {
      provide: DescriptorManagementService,
      useFactory: (c: Container) => {
        let pool: Pool | null = null;
        try {
          pool = c.resolve(MYSQL_POOL_TOKEN) as Pool | null;
        } catch {
          pool = null;
        }
        const repo = new TenantDescriptorRepositoryImpl(pool, sharedSfidService);
        return new DescriptorManagementService(repo);
      },
    },
  ],
  exports: [DescriptorManagementService],
})
export class DescriptorManagementHttpModule {}
