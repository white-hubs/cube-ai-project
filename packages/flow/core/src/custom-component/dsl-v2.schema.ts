import { z } from "zod";

import { type CubeCustomOutput, cubeCustomInputSchema, cubeCustomOutputSchema, metadataSchema } from "./dsl-shared";

export const v2OpActionSchema = z.enum([
  "assign",
  "http_request",
  "json_parse",
  "template_render",
  "http",
  "transform",
  "message_merge",
  "message_to_openai_content",
]);

export type V2OpAction = z.infer<typeof v2OpActionSchema>;

export type CubeCondition =
  | { kind: "non_empty"; field: string }
  | { kind: "is_truthy"; field: string }
  | { kind: "equals"; field: string; value: string | number | boolean }
  | { kind: "and"; conditions: CubeCondition[] }
  | { kind: "or"; conditions: CubeCondition[] }
  | { kind: "not"; condition: CubeCondition };

export const conditionSchema: z.ZodType<CubeCondition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ field: z.string().min(1), kind: z.literal("non_empty") }),
    z.object({ field: z.string().min(1), kind: z.literal("is_truthy") }),
    z.object({
      field: z.string().min(1),
      kind: z.literal("equals"),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({ conditions: z.array(conditionSchema), kind: z.literal("and") }),
    z.object({ conditions: z.array(conditionSchema), kind: z.literal("or") }),
    z.object({ condition: conditionSchema, kind: z.literal("not") }),
  ]),
);

export type CubeWorkflowBlock = CubeOpBlock | CubeIfBlock | CubeForeachBlock;

export interface CubeOpBlock {
  type: "op";
  action: V2OpAction;
  params: Record<string, unknown>;
  output_as?: string;
}

export interface CubeIfBlock {
  type: "if";
  condition: CubeCondition;
  then: CubeWorkflowBlock[];
  else?: CubeWorkflowBlock[];
}

export interface CubeForeachBlock {
  type: "foreach";
  over: string;
  as: string;
  body: CubeWorkflowBlock[];
}

export const workflowBlockSchema: z.ZodType<CubeWorkflowBlock> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      action: v2OpActionSchema,
      output_as: z.string().min(1).optional(),
      params: z.record(z.string(), z.unknown()),
      type: z.literal("op"),
    }),
    z.object({
      condition: conditionSchema,
      else: z.array(workflowBlockSchema).optional(),
      then: z.array(workflowBlockSchema),
      type: z.literal("if"),
    }),
    z.object({
      as: z.string().min(1),
      body: z.array(workflowBlockSchema),
      over: z.string().min(1),
      type: z.literal("foreach"),
    }),
  ]),
);

const uiRuleSchema = z.object({
  hide: z.array(z.string()).optional(),
  if: z.string().min(1),
  show: z.array(z.string()).optional(),
});

export const cubeCustomComponentDslV2Schema = z
  .object({
    dslVersion: z.literal(2),
    extends: z.enum(["component", "vector_store"]).default("component"),
    inputs: z.array(cubeCustomInputSchema).min(1),
    metadata: metadataSchema,
    output: cubeCustomOutputSchema.optional(),
    /** 与 `output` 二选一：非空时优先用本数组作为多输出（含 LanguageModel + Message 等组合） */
    outputs: z.array(cubeCustomOutputSchema).min(1).max(16).optional(),
    traits: z.array(z.string()).optional(),
    ui_rules: z.array(uiRuleSchema).optional(),
    variables: z
      .array(
        z.object({
          name: z.string().min(1),
          initial: z.string().optional(),
        }),
      )
      .optional(),
    workflow: z.object({
      blocks: z.array(workflowBlockSchema).default([]),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.outputs && data.outputs.length > 0 && data.output !== null && data.output !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "DSL v2: use either `output` or `outputs`, not both",
        path: ["outputs"],
      });
    }
  });

export type CubeCustomComponentDslV2 = z.infer<typeof cubeCustomComponentDslV2Schema>;

/** 单输出默认与旧 DSL 一致；`outputs` 优先 */
export function resolveV2ComponentOutputs(dsl: CubeCustomComponentDslV2): CubeCustomOutput[] {
  if (dsl.outputs && dsl.outputs.length > 0) {
    return dsl.outputs;
  }
  return [dsl.output ?? { kind: "data" as const, method: "build_output" }];
}

export function parseCubeCustomComponentDslV2(raw: unknown): CubeCustomComponentDslV2 {
  return cubeCustomComponentDslV2Schema.parse(raw);
}

export function safeParseCubeCustomComponentDslV2(raw: unknown): ReturnType<typeof cubeCustomComponentDslV2Schema.safeParse> {
  return cubeCustomComponentDslV2Schema.safeParse(raw);
}
