import "reflect-metadata";
import { Controller } from "@dangao/bun-server";

import { GrantController } from "../../../../packages/agent/engine/src/bc/authz/grant.controller";
import { DescriptorMcpController } from "../../../../packages/agent/engine/src/bc/descriptor-mcp/descriptor-mcp.controller";
import {
  DescriptorManagementController,
  DescriptorManagementLegacyController,
} from "../../../../packages/agent/engine/src/bc/descriptor/descriptor-management.controller";
import { LibraryController, ListingController } from "../../../../packages/agent/engine/src/bc/descriptor/listing.controller";
import { PluginCatalogController } from "../../../../packages/agent/engine/src/bc/descriptor/plugin-catalog.controller";
import { MyShelfController } from "../../../../packages/agent/engine/src/bc/descriptor/shelf.controller";
import { LocalFileController } from "../../../../packages/agent/engine/src/bc/files/local-file.controller";
import { JobsController } from "../../../../packages/agent/engine/src/bc/jobs/jobs.controller";
import { SessionController } from "../../../../packages/agent/engine/src/bc/session/session.controller";
import { ComponentsController } from "../../../../packages/flow/core/src/components/components.controller";
import { CustomComponentTemplatesController } from "../../../../packages/flow/core/src/custom-component-templates/custom-component-templates.controller";
import { FlowFilesController } from "../../../../packages/flow/core/src/flows/flow-files.controller";
import { FlowMonitorController } from "../../../../packages/flow/core/src/flows/flow-monitor.controller";
import { FlowsController } from "../../../../packages/flow/core/src/flows/flows.controller";
import { McpToolsController } from "../../../../packages/flow/core/src/mcp/mcp-tools.controller";
import { ExecutionMetricsController } from "../../../../packages/flow/core/src/observability/execution-metrics.controller";
import { RunController } from "../../../../packages/flow/core/src/run/run.controller";
import { WebhookController } from "../../../../packages/flow/core/src/webhook/webhook.controller";
import { FlowStudioController } from "../../../../packages/flow/studio/src/http/flow-studio.controller";
import { DocumentDirectoryController } from "../../../../packages/kb/core/src/modules/documents/controllers/document-directory.controller";
import { DocumentController } from "../../../../packages/kb/core/src/modules/documents/controllers/document.controller";
import { SearchController } from "../../../../packages/kb/core/src/modules/vector-store/controllers/search.controller";
import { LlmCatalogAdminController } from "../../../../packages/llm/core/src/http/llm-catalog-admin.controller";
import { LlmProvidersController } from "../../../../packages/llm/core/src/http/llm-providers.controller";

// ── Agent consumption ────────────────────────────────────────────────────────
// ── Agent management ─────────────────────────────────────────────────────────
// ── LLM consumption ──────────────────────────────────────────────────────────
// ── LLM management ───────────────────────────────────────────────────────────
// ── Flow consumption ─────────────────────────────────────────────────────────
// ── Flow management ──────────────────────────────────────────────────────────
// ── KB consumption ───────────────────────────────────────────────────────────
// ── KB management ────────────────────────────────────────────────────────────

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
  { base: "/agent/sessions", controller: SessionController },
  { base: "/agent/jobs", controller: JobsController },
  { base: "/agent/grants", controller: GrantController },
  { base: "/agent/files", controller: LocalFileController },
  { base: "/agent/mcp/descriptor", controller: DescriptorMcpController },

  // agent management (canonical /agent/console/*; legacy /agent/{kind} for upstream callers)
  { base: "/agent/console", controller: DescriptorManagementController },
  { base: "/agent/console", controller: ListingController },
  { base: "/agent/console", controller: LibraryController },
  { base: "/agent/console", controller: MyShelfController },
  { base: "/agent/console", controller: PluginCatalogController },
  { base: "/agent", controller: DescriptorManagementLegacyController },

  // llm consumption
  { base: "/llm/providers", controller: LlmProvidersController },

  // llm management
  { base: "/llm/console", controller: LlmCatalogAdminController },

  // flow consumption
  { base: "/flow/run", controller: RunController },
  { base: "/flow/webhook", controller: WebhookController },
  { base: "/flow", controller: FlowFilesController },

  // flow management
  { base: "/flow/console/flows", controller: FlowsController },
  { base: "/flow/console/flows", controller: FlowMonitorController },
  { base: "/flow/console/studio", controller: FlowStudioController },
  { base: "/flow/console/components", controller: ComponentsController },
  { base: "/flow/console/mcp", controller: McpToolsController },
  { base: "/flow/console/custom-component-templates", controller: CustomComponentTemplatesController },
  { base: "/flow/console/execution", controller: ExecutionMetricsController },

  // kb consumption
  { base: "/kb/search", controller: SearchController },

  // kb management
  { base: "/kb/console/documents", controller: DocumentController },
  { base: "/kb/console/documents/directories", controller: DocumentDirectoryController },
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
