import { MockRegistry } from "@cube-ai/ai-center/platform/server-mock";

const minimalSchema = (cubeType: string) => ({
  componentToolModeDefault: false,
  cubeType,
  description: "mock",
  displayName: "Mock Component",
  inputs: [],
  lfComponentKey: "Mock",
  outputs: [{ name: "message", displayName: "Message", types: ["Message"], toolMode: false, allowsLoop: false }],
  version: 1,
});

const reg = MockRegistry.getInstance();

reg.define("components.catalog", false, () => ({ components: [], version: 1 }));

reg.define("components.schemaAll", false, () => ({ schemas: [] as ReturnType<typeof minimalSchema>[] }));

reg.define("components.schema", false, (_ctx, args) => {
  const raw = args[0] === null || args[0] === undefined ? "" : String(args[0]);
  const cubeType = raw.trim() || "cube.lf.Mock";
  return minimalSchema(cubeType.startsWith("cube.lf.") ? cubeType : `cube.lf.${cubeType}`);
});

reg.define("components.schemaCustomDsl", false, (_ctx, args) => {
  const body = (args[0] as { cube_dsl?: unknown }) ?? {};
  void body.cube_dsl;
  return minimalSchema("cube.lf.CustomComponent");
});
