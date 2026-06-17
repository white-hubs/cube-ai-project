import 'reflect-metadata';
import { Controller } from '@dangao/bun-server';

// ── Agent consumption ────────────────────────────────────────────────────────
import { SessionController } from '../../../../packages/agent/engine/src/bc/session/session.controller';
import { JobsController } from '../../../../packages/agent/engine/src/bc/jobs/jobs.controller';
import { GrantController } from '../../../../packages/agent/engine/src/bc/authz/grant.controller';
import { LocalFileController } from '../../../../packages/agent/engine/src/bc/files/local-file.controller';
import { DescriptorMcpController } from '../../../../packages/agent/engine/src/bc/descriptor-mcp/descriptor-mcp.controller';

// ── Agent management ─────────────────────────────────────────────────────────
import {
  DescriptorManagementController,
  DescriptorManagementLegacyController,
} from '../../../../packages/agent/engine/src/bc/descriptor/descriptor-management.controller';

// ── LLM consumption ──────────────────────────────────────────────────────────
import { LlmProvidersController } from '../../../../packages/llm/core/src/http/llm-providers.controller';

// ── LLM management ───────────────────────────────────────────────────────────
import { LlmCatalogAdminController } from '../../../../packages/llm/core/src/http/llm-catalog-admin.controller';

// ── Flow consumption ─────────────────────────────────────────────────────────
import { RunController } from '../../../../packages/flow/core/src/run/run.controller';
import { WebhookController } from '../../../../packages/flow/core/src/webhook/webhook.controller';
import { FlowFilesController } from '../../../../packages/flow/core/src/flows/flow-files.controller';

// ── Flow management ──────────────────────────────────────────────────────────
import { FlowsController } from '../../../../packages/flow/core/src/flows/flows.controller';
import { FlowMonitorController } from '../../../../packages/flow/core/src/flows/flow-monitor.controller';
import { FlowStudioController } from '../../../../packages/flow/studio/src/http/flow-studio.controller';
import { ComponentsController } from '../../../../packages/flow/core/src/components/components.controller';
import { McpToolsController } from '../../../../packages/flow/core/src/mcp/mcp-tools.controller';
import { CustomComponentTemplatesController } from '../../../../packages/flow/core/src/custom-component-templates/custom-component-templates.controller';
import { ExecutionMetricsController } from '../../../../packages/flow/core/src/observability/execution-metrics.controller';

// ── KB consumption ───────────────────────────────────────────────────────────
import { SearchController } from '../../../../packages/kb/core/src/modules/vector-store/controllers/search.controller';

// ── KB management ────────────────────────────────────────────────────────────
import { DocumentController } from '../../../../packages/kb/core/src/modules/documents/controllers/document.controller';
import { DocumentDirectoryController } from '../../../../packages/kb/core/src/modules/documents/controllers/document-directory.controller';

type AnyConstructor = abstract new (...args: never[]) => unknown;

interface DomainPrefixMount {
  controller: AnyConstructor;
  base: string;
}

/**
 * Assembly-time domain prefix mounts.
 *
 * Each entry maps a BC controller class to its domain-prefixed base path.
 * The @Controller decorator on the source file stays domain-agnostic;
 * ai-center overwrites the reflect-metadata base here, before any module
 * is registered, so ControllerRegistry picks up the correct path.
 *
 * Infra controllers (HealthController, MetricsController, etc.) and
 * LlmGatewayController (/v1) are intentionally absent — they are not remapped.
 */
export const DOMAIN_PREFIX_MOUNTS: DomainPrefixMount[] = [
  // agent consumption
  { controller: SessionController, base: '/agent/sessions' },
  { controller: JobsController, base: '/agent/jobs' },
  { controller: GrantController, base: '/agent/grants' },
  { controller: LocalFileController, base: '/agent/files' },
  { controller: DescriptorMcpController, base: '/agent/mcp/descriptor' },

  // agent management (canonical /agent/console/*; legacy /agent/{kind} for upstream callers)
  { controller: DescriptorManagementController, base: '/agent/console' },
  { controller: DescriptorManagementLegacyController, base: '/agent' },

  // llm consumption
  { controller: LlmProvidersController, base: '/llm/providers' },

  // llm management
  { controller: LlmCatalogAdminController, base: '/llm/console' },

  // flow consumption
  { controller: RunController, base: '/flow/run' },
  { controller: WebhookController, base: '/flow/webhook' },
  { controller: FlowFilesController, base: '/flow' },

  // flow management
  { controller: FlowsController, base: '/flow/console/flows' },
  { controller: FlowMonitorController, base: '/flow/console/flows' },
  { controller: FlowStudioController, base: '/flow/console/studio' },
  { controller: ComponentsController, base: '/flow/console/components' },
  { controller: McpToolsController, base: '/flow/console/mcp' },
  { controller: CustomComponentTemplatesController, base: '/flow/console/custom-component-templates' },
  { controller: ExecutionMetricsController, base: '/flow/console/execution' },

  // kb consumption
  { controller: SearchController, base: '/kb/search' },

  // kb management
  { controller: DocumentController, base: '/kb/console/documents' },
  { controller: DocumentDirectoryController, base: '/kb/console/documents/directories' },
];

/**
 * Overwrite each controller's @Controller base path metadata at assembly time.
 *
 * Must be called at the top of AiCenterAssembler.assemble(), before any
 * app.registerModule() call. ControllerRegistry reads the metadata synchronously
 * during registerModule(), so pre-mutation is sufficient — no fallback needed.
 */
export function applyDomainPrefixMounts(): void {
  for (const { controller, base } of DOMAIN_PREFIX_MOUNTS) {
    Controller(base)(controller as new (...args: never[]) => unknown);
  }
}
