import { z } from 'zod'
import {
  cubeCustomInputSchema,
  cubeCustomOutputSchema,
  metadataSchema,
  type CubeCustomOutput,
} from './dsl-shared'

export const v2OpActionSchema = z.enum([
  'assign',
  'http_request',
  'json_parse',
  'template_render',
  'http',
  'transform',
  'message_merge',
  'message_to_openai_content',
])

export type V2OpAction = z.infer<typeof v2OpActionSchema>

export type CubeCondition =
  | { kind: 'non_empty'; field: string }
  | { kind: 'is_truthy'; field: string }
  | { kind: 'equals'; field: string; value: string | number | boolean }
  | { kind: 'and'; conditions: CubeCondition[] }
  | { kind: 'or'; conditions: CubeCondition[] }
  | { kind: 'not'; condition: CubeCondition }

export const conditionSchema: z.ZodType<CubeCondition> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('non_empty'), field: z.string().min(1) }),
    z.object({ kind: z.literal('is_truthy'), field: z.string().min(1) }),
    z.object({
      kind: z.literal('equals'),
      field: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({ kind: z.literal('and'), conditions: z.array(conditionSchema) }),
    z.object({ kind: z.literal('or'), conditions: z.array(conditionSchema) }),
    z.object({ kind: z.literal('not'), condition: conditionSchema }),
  ]),
)

export type CubeWorkflowBlock = CubeOpBlock | CubeIfBlock | CubeForeachBlock

export type CubeOpBlock = {
  type: 'op'
  action: V2OpAction
  params: Record<string, unknown>
  output_as?: string
}

export type CubeIfBlock = {
  type: 'if'
  condition: CubeCondition
  then: CubeWorkflowBlock[]
  else?: CubeWorkflowBlock[]
}

export type CubeForeachBlock = {
  type: 'foreach'
  over: string
  as: string
  body: CubeWorkflowBlock[]
}

export const workflowBlockSchema: z.ZodType<CubeWorkflowBlock> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('op'),
      action: v2OpActionSchema,
      params: z.record(z.string(), z.unknown()),
      output_as: z.string().min(1).optional(),
    }),
    z.object({
      type: z.literal('if'),
      condition: conditionSchema,
      then: z.array(workflowBlockSchema),
      else: z.array(workflowBlockSchema).optional(),
    }),
    z.object({
      type: z.literal('foreach'),
      over: z.string().min(1),
      as: z.string().min(1),
      body: z.array(workflowBlockSchema),
    }),
  ]),
)

const uiRuleSchema = z.object({
  if: z.string().min(1),
  hide: z.array(z.string()).optional(),
  show: z.array(z.string()).optional(),
})

export const cubeCustomComponentDslV2Schema = z.object({
  dslVersion: z.literal(2),
  extends: z.enum(['component', 'vector_store']).default('component'),
  traits: z.array(z.string()).optional(),
  metadata: metadataSchema,
  inputs: z.array(cubeCustomInputSchema).min(1),
  variables: z
    .array(
      z.object({
        name: z.string().min(1),
        initial: z.string().optional(),
      }),
    )
    .optional(),
  /** 与 `output` 二选一：非空时优先用本数组作为多输出（含 LanguageModel + Message 等组合） */
  outputs: z.array(cubeCustomOutputSchema).min(1).max(16).optional(),
  output: cubeCustomOutputSchema.optional(),
  workflow: z.object({
    blocks: z.array(workflowBlockSchema).default([]),
  }),
  ui_rules: z.array(uiRuleSchema).optional(),
})
  .superRefine((data, ctx) => {
    if (data.outputs && data.outputs.length > 0 && data.output != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'DSL v2: use either `output` or `outputs`, not both',
        path: ['outputs'],
      })
    }
  })

export type CubeCustomComponentDslV2 = z.infer<typeof cubeCustomComponentDslV2Schema>

/** 单输出默认与旧 DSL 一致；`outputs` 优先 */
export function resolveV2ComponentOutputs(dsl: CubeCustomComponentDslV2): CubeCustomOutput[] {
  if (dsl.outputs && dsl.outputs.length > 0) return dsl.outputs
  return [dsl.output ?? { kind: 'data' as const, method: 'build_output' }]
}

export function parseCubeCustomComponentDslV2(raw: unknown): CubeCustomComponentDslV2 {
  return cubeCustomComponentDslV2Schema.parse(raw)
}

export function safeParseCubeCustomComponentDslV2(
  raw: unknown,
): ReturnType<typeof cubeCustomComponentDslV2Schema.safeParse> {
  return cubeCustomComponentDslV2Schema.safeParse(raw)
}
