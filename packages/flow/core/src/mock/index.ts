/**
 * Flow 域 HTTP mock：仅注册本包 handlers；框架见 `@cube-ai/ai-center/platform/server-mock`。
 */

import "./handlers/run.mock";
import "./handlers/webhook.mock";
import "./handlers/execution-metrics.mock";
import "./handlers/flows.mock";
import "./handlers/components.mock";
import "./handlers/mcp.mock";
import "./handlers/custom-component-templates.mock";

export {
  isMockEnabled,
  MockableEndpoint,
  MOCK_METADATA_KEY,
  MockInterceptor,
  MockRegistry,
  registerMockInterceptor,
  type MockEndpointMeta,
  type MockHandlerFn,
  type MockRegistryEntry,
} from "@cube-ai/ai-center/platform/server-mock";
