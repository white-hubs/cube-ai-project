import { MockRegistry } from "@cube-ai/ai-center/platform/server-mock";

const reg = MockRegistry.getInstance();
const iso = "2025-01-01T00:00:00.000Z";

reg.define("custom-component-templates.list", false, () => ({ templates: [] as unknown[] }));

reg.define("custom-component-templates.validate", false, () => ({ ok: true as const }));

reg.define("custom-component-templates.create", false, (_ctx, args) => {
  const body = (args[0] as { dsl?: unknown; displayName?: string }) ?? {};
  const id = crypto.randomUUID();
  return {
    displayName: body.displayName?.trim() || "mock-template",
    dsl: body.dsl ?? {},
    id,
  };
});

reg.define("custom-component-templates.get", false, (_ctx, args) => {
  const id = String(args[0] ?? "mock");
  return {
    displayName: "mock-template",
    dsl: { steps: [], version: 1 },
    id,
    update_time: iso,
  };
});

reg.define("custom-component-templates.update", false, (_ctx, args) => {
  const id = String(args[0] ?? "mock");
  const body = (args[1] as { dsl?: unknown; displayName?: string }) ?? {};
  return {
    displayName: body.displayName?.trim() || "mock-template",
    dsl: body.dsl ?? { version: 1, steps: [] },
    id,
    update_time: iso,
  };
});

reg.define("custom-component-templates.remove", false, () => ({ ok: true as const }));
