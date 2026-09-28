import { Module } from "@dangao/bun-server";

import { AuditModule } from "../../infra/audit/audit.module";
import { SfidModule } from "../../infra/sfid/sfid.module";
import { AuthzModule } from "../authz/authz.module";
import { descriptorManagementServiceProvider } from "../descriptor/descriptor-management.provider";
import { DescriptorManagementService } from "../descriptor/descriptor-management.service";
import { DescriptorModule } from "../descriptor/descriptor.module";
import { JobsModule } from "../jobs/jobs.module";
import { createEngineMysqlPool } from "../session/mysql-pool";
import { TachuRuntimeModule } from "../tachu/tachu-runtime.module";
import { AskBusinessDataProgram } from "./biz-ontology-ask";
import { ClockHandler } from "./handlers/clock-handler";
import { DescriptorOpsHandler } from "./handlers/descriptor-ops-handler";
import { FlowHandler } from "./handlers/flow-handler";
import { FlowListHandler } from "./handlers/flow-list-handler";
import { HttpHandler } from "./handlers/http-handler";
import { KnowledgeHandler } from "./handlers/knowledge-handler";
import { LlmHandler } from "./handlers/llm-handler";
import { McpHandler } from "./handlers/mcp-handler";
import { MemoryHandler } from "./handlers/memory-handler";
import { MysqlSessionTranscriptReader } from "./handlers/mysql-session-transcript-reader";
import { OpenApiHandler } from "./handlers/openapi-handler";
import { QwenImageHandler } from "./handlers/qwen-image-handler";
import { SessionRecallHandler, SESSION_TRANSCRIPT_READER_TOKEN } from "./handlers/session-recall-handler";
import { ShellHandler } from "./handlers/shell-handler";
import { SqlHandler } from "./handlers/sql-handler";
import { VectorHandler } from "./handlers/vector-handler";
import { McpBridgeService } from "./mcp-bridge.service";
import { McpToolRegistrationWorker } from "./mcp-tool-registration.worker";
import { ToolService } from "./tool.service";

/**
 * Tools BC Module。
 *
 * 依赖 Authz（鉴权）、Jobs（LONG_RUNNING 入队）、Audit（审计）、Sfid（job/tool id）。
 */
@Module({
  imports: [DescriptorModule, AuthzModule, JobsModule, AuditModule, SfidModule, TachuRuntimeModule],
  providers: [
    HttpHandler,
    ShellHandler,
    SqlHandler,
    VectorHandler,
    MemoryHandler,
    OpenApiHandler,
    McpBridgeService,
    McpToolRegistrationWorker,
    McpHandler,
    AskBusinessDataProgram,
    LlmHandler,
    FlowHandler,
    FlowListHandler,
    KnowledgeHandler,
    ClockHandler,
    {
      provide: SESSION_TRANSCRIPT_READER_TOKEN,
      useFactory: () => new MysqlSessionTranscriptReader(createEngineMysqlPool()),
    },
    SessionRecallHandler,
    QwenImageHandler,
    descriptorManagementServiceProvider,
    DescriptorOpsHandler,
    ToolService,
  ],
  exports: [ToolService, McpBridgeService, McpToolRegistrationWorker, DescriptorManagementService],
})
export class ToolsModule {}
