import { MockRegistry } from "@cube-ai/ai-center/platform/server-mock";

MockRegistry.getInstance().define("metrics.summary", false, () => ({
  byFlow: {},
  byTenantId: {},
  recentCount: 0,
}));

MockRegistry.getInstance().define("metrics.recent", false, () => []);
