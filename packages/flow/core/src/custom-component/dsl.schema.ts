import { type z } from "zod";

import { cubeCustomComponentDslSchemaV1 } from "./dsl-shared";

export {
  cubeCustomInputSchema,
  cubeCustomOutputSchema,
  cubeCustomStepSchema,
  metadataSchema,
  type CubeCustomInput,
  type CubeCustomOutput,
  type CubeCustomStep,
} from "./dsl-shared";

export const cubeCustomComponentDslSchema = cubeCustomComponentDslSchemaV1;

export type CubeCustomComponentDsl = z.infer<typeof cubeCustomComponentDslSchemaV1>;

export function parseCubeCustomComponentDsl(raw: unknown): CubeCustomComponentDsl {
  return cubeCustomComponentDslSchemaV1.parse(raw);
}

export function safeParseCubeCustomComponentDsl(raw: unknown): ReturnType<typeof cubeCustomComponentDslSchemaV1.safeParse> {
  return cubeCustomComponentDslSchemaV1.safeParse(raw);
}

/** 从原始对象读取 dslVersion；缺省为 1。 */
export function detectCustomDslVersion(raw: unknown): 1 | 2 {
  if (typeof raw !== "object" || raw === null) {
    return 1;
  }
  const v = (raw as Record<string, unknown>)["dslVersion"];
  if (v === 2) {
    return 2;
  }
  return 1;
}
