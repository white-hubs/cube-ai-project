/**
 * DescriptorMcpModule — engine 出站 MCP server 门面装配（ADR-0027 §8）。
 *
 * 复用与进程内面同一「核」：经 {@link descriptorManagementServiceProvider} 提供
 * {@link DescriptorManagementService}，门面 {@link DescriptorMcpService} 与
 * Tool Handler 共享 ops 逻辑（不重复实现业务）。
 */
import { Module } from '@dangao/bun-server';
import { descriptorManagementServiceProvider } from '../descriptor/descriptor-management.provider';
import { DescriptorManagementService } from '../descriptor/descriptor-management.service';
import { DescriptorMcpService } from './descriptor-mcp.service';
import { DescriptorMcpController } from './descriptor-mcp.controller';

@Module({
  controllers: [DescriptorMcpController],
  providers: [descriptorManagementServiceProvider, DescriptorMcpService],
  exports: [DescriptorMcpService, DescriptorManagementService],
})
export class DescriptorMcpModule {}
