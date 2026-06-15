import { Module } from '@dangao/bun-server';
import { DescriptorModule } from '../descriptor/descriptor.module';
import { AuthzModule } from '../authz/authz.module';
import { JobsModule } from '../jobs/jobs.module';
import { AuditModule } from '../../infra/audit/audit.module';
import { SfidModule } from '../../infra/sfid/sfid.module';
import { TachuRuntimeModule } from '../tachu/tachu-runtime.module';
import { ToolService } from './tool.service';
import { McpBridgeService } from './mcp-bridge.service';
import { HttpHandler } from './handlers/http-handler';
import { ShellHandler } from './handlers/shell-handler';
import { SqlHandler } from './handlers/sql-handler';
import { VectorHandler } from './handlers/vector-handler';
import { MemoryHandler } from './handlers/memory-handler';
import { OpenApiHandler } from './handlers/openapi-handler';
import { McpHandler } from './handlers/mcp-handler';
import { LlmHandler } from './handlers/llm-handler';
import { FlowHandler } from './handlers/flow-handler';
import { FlowListHandler } from './handlers/flow-list-handler';
import { KnowledgeHandler } from './handlers/knowledge-handler';
import { ClockHandler } from './handlers/clock-handler';
import { QwenImageHandler } from './handlers/qwen-image-handler';
import { DescriptorOpsHandler } from './handlers/descriptor-ops-handler';
import { descriptorManagementServiceProvider } from '../descriptor/descriptor-management.provider';
import { DescriptorManagementService } from '../descriptor/descriptor-management.service';

/**
 * Tools BC Module。
 *
 * 依赖 Authz（鉴权）、Jobs（LONG_RUNNING 入队）、Audit（审计）、Sfid（job/tool id）。
 */
@Module({
  imports: [
    DescriptorModule,
    AuthzModule,
    JobsModule,
    AuditModule,
    SfidModule,
    TachuRuntimeModule,
  ],
  providers: [
    HttpHandler,
    ShellHandler,
    SqlHandler,
    VectorHandler,
    MemoryHandler,
    OpenApiHandler,
    McpBridgeService,
    McpHandler,
    LlmHandler,
    FlowHandler,
    FlowListHandler,
    KnowledgeHandler,
    ClockHandler,
    QwenImageHandler,
    descriptorManagementServiceProvider,
    DescriptorOpsHandler,
    ToolService,
  ],
  exports: [ToolService, McpBridgeService, DescriptorManagementService],
})
export class ToolsModule {}
