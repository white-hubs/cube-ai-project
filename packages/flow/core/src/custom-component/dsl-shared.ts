import { z } from 'zod'

export const metadataSchema = z.object({
  name: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  documentation: z.string().optional(),
  wrap_build_in_try: z.boolean().optional().default(true),
})

const inputMessageText = z.object({
  kind: z.literal('message_text'),
  name: z.string().min(1),
  display_name: z.string().min(1),
  info: z.string().optional(),
  tool_mode: z.boolean().optional(),
  default: z.string().optional(),
})

const inputStr = z.object({
  kind: z.literal('str'),
  name: z.string().min(1),
  display_name: z.string().min(1),
  info: z.string().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
})

const inputBool = z.object({
  kind: z.literal('bool'),
  name: z.string().min(1),
  display_name: z.string().min(1),
  info: z.string().optional(),
  default: z.boolean().optional(),
})

const inputSecret = z.object({
  kind: z.literal('secret_str'),
  name: z.string().min(1),
  display_name: z.string().min(1),
  info: z.string().optional(),
  required: z.boolean().optional(),
})

const inputInt = z.object({
  kind: z.literal('int'),
  name: z.string().min(1),
  display_name: z.string().min(1),
  info: z.string().optional(),
  default: z.number().int().optional(),
})

const inputFloat = z.object({
  kind: z.literal('float'),
  name: z.string().min(1),
  display_name: z.string().min(1),
  info: z.string().optional(),
  default: z.number().optional(),
})

const inputDropdown = z.object({
  kind: z.literal('dropdown'),
  name: z.string().min(1),
  display_name: z.string().min(1),
  info: z.string().optional(),
  options: z.array(z.string()).min(1),
  default: z.string().optional(),
})

/** 对应 lfx.io.HandleInput（画布侧边连接桩，如向量库的 Ingest Data） */
const inputHandle = z.object({
  kind: z.literal('handle'),
  name: z.string().min(1),
  display_name: z.string().min(1),
  info: z.string().optional(),
  required: z.boolean().optional(),
  input_types: z.array(z.string()).min(1),
  /** 与 Langflow 模板中 list / 多值连接一致，生成 `is_list=True` */
  is_list: z.boolean().optional(),
})

export const cubeCustomInputSchema = z.discriminatedUnion('kind', [
  inputMessageText,
  inputStr,
  inputBool,
  inputSecret,
  inputInt,
  inputFloat,
  inputDropdown,
  inputHandle,
])

export type CubeCustomInput = z.infer<typeof cubeCustomInputSchema>

export const cubeCustomOutputSchema = z.object({
  kind: z.enum(['data', 'message', 'text', 'language_model']),
  method: z.string().min(1).default('build_output'),
  display_name: z.string().optional(),
  name: z.string().optional(),
  /** workflow 中赋值的 Python 变量名；多输出时建议填写。缺省时用流水线最后一个值（与单输出一致） */
  value_from: z.string().min(1).optional(),
})

export type CubeCustomOutput = z.infer<typeof cubeCustomOutputSchema>

export const cubeCustomStepSchema = z.object({
  action: z.enum(['assign', 'http_request', 'json_parse', 'template_render']),
  params: z.record(z.string(), z.unknown()),
})

export type CubeCustomStep = z.infer<typeof cubeCustomStepSchema>

export const cubeCustomComponentDslSchemaV1 = z.object({
  dslVersion: z.literal(1),
  metadata: metadataSchema,
  inputs: z.array(cubeCustomInputSchema).min(1),
  output: cubeCustomOutputSchema,
  steps: z.array(cubeCustomStepSchema).default([]),
})
