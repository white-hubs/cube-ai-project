export type LlmSchemaFieldType = 'string' | 'boolean' | 'integer' | 'number' | 'enum';

export interface LlmSchemaFieldOption extends Record<string, unknown> {
  label: string;
  value: string;
}

export interface LlmSchemaField extends Record<string, unknown> {
  key: string;
  label?: string;
  type: LlmSchemaFieldType;
  required?: boolean;
  description?: string;
  defaultValue?: string | number | boolean | null;
  options?: LlmSchemaFieldOption[];
  feature?: string;
  wirePath?: string;
  wireTransform?: string;
}

export interface LlmRequestSchema extends Record<string, unknown> {
  requestShape: string;
  endpointPath?: string;
  method?: 'GET' | 'POST';
  modelField?: string;
  inputContainer?: string;
  parameterContainer?: string;
  inputMapping?: Record<string, string>;
  fields?: LlmSchemaField[];
  extraBodyFields?: LlmSchemaField[];
}

export interface LlmResponsePollingSchema extends Record<string, unknown> {
  enabled: boolean;
  taskIdPath?: string;
  taskStatusPath?: string;
  queryPathTemplate?: string;
  terminalStatuses?: string[];
}

export interface LlmResponseSchema extends Record<string, unknown> {
  responseShape: string;
  polling?: LlmResponsePollingSchema;
  resultMapping?: Record<string, string>;
  errorMapping?: Record<string, string>;
}

export type LlmDslNodeKind = 'language_model' | 'image_generation';

export interface LlmDslField extends Record<string, unknown> {
  key: string;
  label?: string;
  type: LlmSchemaFieldType;
  required?: boolean;
  description?: string;
}

export interface LlmDslSchema extends Record<string, unknown> {
  nodeKind: LlmDslNodeKind;
  interactionMode?: 'sync' | 'async';
  primaryInput?: string;
  inputs?: LlmDslField[];
  parameters?: LlmDslField[];
  outputs?: LlmDslField[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function safeParseJsonObject<T extends Record<string, unknown>>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function splitModelTypes(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFieldType(value: unknown): value is LlmSchemaFieldType {
  return value === 'string' || value === 'boolean' || value === 'integer' || value === 'number' || value === 'enum';
}

function validateFieldArray(schemaName: string, fieldName: string, value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${schemaName}.${fieldName} 必须为数组`);
    return;
  }
  value.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`${schemaName}.${fieldName}[${index}] 必须为对象`);
      return;
    }
    if (!isNonEmptyString(item.key)) {
      errors.push(`${schemaName}.${fieldName}[${index}].key 不能为空`);
    }
    if (!isFieldType(item.type)) {
      errors.push(`${schemaName}.${fieldName}[${index}].type 非法`);
    }
    if (item.options !== undefined) {
      if (!Array.isArray(item.options)) {
        errors.push(`${schemaName}.${fieldName}[${index}].options 必须为数组`);
      } else {
        item.options.forEach((option, optionIndex) => {
          if (!isObject(option) || !isNonEmptyString(option.label) || !isNonEmptyString(option.value)) {
            errors.push(`${schemaName}.${fieldName}[${index}].options[${optionIndex}] 非法`);
          }
        });
      }
    }
  });
}

function validateStringMap(schemaName: string, fieldName: string, value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push(`${schemaName}.${fieldName} 必须为对象`);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!isNonEmptyString(item)) {
      errors.push(`${schemaName}.${fieldName}.${key} 必须为非空字符串`);
    }
  }
}

export function validateRequestSchema(schema: Record<string, unknown> | null | undefined): string[] {
  if (schema == null) return [];
  const errors: string[] = [];
  if (!isNonEmptyString(schema.requestShape)) errors.push('requestSchema.requestShape 不能为空');
  if (schema.endpointPath !== undefined && !isNonEmptyString(schema.endpointPath)) {
    errors.push('requestSchema.endpointPath 不能为空');
  }
  if (schema.method !== undefined && schema.method !== 'GET' && schema.method !== 'POST') {
    errors.push('requestSchema.method 仅支持 GET 或 POST');
  }
  if (schema.modelField !== undefined && !isNonEmptyString(schema.modelField)) {
    errors.push('requestSchema.modelField 不能为空');
  }
  if (schema.inputContainer !== undefined && !isNonEmptyString(schema.inputContainer)) {
    errors.push('requestSchema.inputContainer 不能为空');
  }
  if (schema.parameterContainer !== undefined && !isNonEmptyString(schema.parameterContainer)) {
    errors.push('requestSchema.parameterContainer 不能为空');
  }
  validateStringMap('requestSchema', 'inputMapping', schema.inputMapping, errors);
  validateFieldArray('requestSchema', 'fields', schema.fields, errors);
  validateFieldArray('requestSchema', 'extraBodyFields', schema.extraBodyFields, errors);

  if (schema.requestShape === 'dashscope_multimodal_generation') {
    if (!isNonEmptyString(schema.endpointPath)) errors.push('requestSchema.endpointPath 不能为空');
    if (schema.method !== 'POST') errors.push('requestSchema.method 必须为 POST');
    if (!isNonEmptyString(schema.parameterContainer)) errors.push('requestSchema.parameterContainer 不能为空');
    const inputMapping = schema.inputMapping;
    if (!isObject(inputMapping) || !isNonEmptyString(inputMapping.userTextPath)) {
      errors.push('requestSchema.inputMapping.userTextPath 不能为空');
    }
  }

  if (schema.requestShape === 'openai_chat_compatible' && schema.extraBodyFields !== undefined && !Array.isArray(schema.extraBodyFields)) {
    errors.push('requestSchema.extraBodyFields 必须为数组');
  }

  if (schema.requestShape === 'openai_images_generation') {
    if (!isNonEmptyString(schema.endpointPath)) errors.push('requestSchema.endpointPath 不能为空');
    if (schema.method !== 'POST') errors.push('requestSchema.method 必须为 POST');
    if (!isNonEmptyString(schema.modelField)) errors.push('requestSchema.modelField 不能为空');
  }
  return errors;
}

export function validateResponseSchema(schema: Record<string, unknown> | null | undefined): string[] {
  if (schema == null) return [];
  const errors: string[] = [];
  if (!isNonEmptyString(schema.responseShape)) errors.push('responseSchema.responseShape 不能为空');
  validateStringMap('responseSchema', 'resultMapping', schema.resultMapping, errors);
  validateStringMap('responseSchema', 'errorMapping', schema.errorMapping, errors);
  if (schema.polling !== undefined) {
    const polling = schema.polling;
    if (!isObject(polling)) {
      errors.push('responseSchema.polling 必须为对象');
    } else {
      if (typeof polling.enabled !== 'boolean') errors.push('responseSchema.polling.enabled 必须为布尔值');
      if (polling.taskIdPath !== undefined && !isNonEmptyString(polling.taskIdPath)) {
        errors.push('responseSchema.polling.taskIdPath 不能为空');
      }
      if (polling.taskStatusPath !== undefined && !isNonEmptyString(polling.taskStatusPath)) {
        errors.push('responseSchema.polling.taskStatusPath 不能为空');
      }
      if (polling.queryPathTemplate !== undefined && !isNonEmptyString(polling.queryPathTemplate)) {
        errors.push('responseSchema.polling.queryPathTemplate 不能为空');
      }
      if (polling.terminalStatuses !== undefined) {
        if (!Array.isArray(polling.terminalStatuses) || polling.terminalStatuses.some((item) => !isNonEmptyString(item))) {
          errors.push('responseSchema.polling.terminalStatuses 必须为非空字符串数组');
        }
      }
    }
  }

  if (schema.responseShape === 'dashscope_async_image_task') {
    const polling = schema.polling;
    if (!isObject(polling) || polling.enabled !== true) errors.push('responseSchema.polling.enabled 必须为 true');
    const resultMapping = schema.resultMapping;
    if (!isObject(resultMapping) || !isNonEmptyString(resultMapping.taskId) || !isNonEmptyString(resultMapping.taskStatus)) {
      errors.push('responseSchema.resultMapping.taskId/taskStatus 不能为空');
    }
  }

  if (schema.responseShape === 'dashscope_multimodal_image_generation') {
    const resultMapping = schema.resultMapping;
    if (!isObject(resultMapping) || !isNonEmptyString(resultMapping.imageUrl)) {
      errors.push('responseSchema.resultMapping.imageUrl 不能为空');
    }
  }

  if (schema.responseShape === 'openai_images_generation') {
    const resultMapping = schema.resultMapping;
    if (!isObject(resultMapping) || !isNonEmptyString(resultMapping.imageUrl)) {
      errors.push('responseSchema.resultMapping.imageUrl 不能为空');
    }
  }

  return errors;
}

export function validateDslSchema(schema: Record<string, unknown> | null | undefined): string[] {
  if (schema == null) return [];
  const errors: string[] = [];
  if (schema.nodeKind !== 'language_model' && schema.nodeKind !== 'image_generation') {
    errors.push('dslSchema.nodeKind 非法');
  }
  if (schema.interactionMode !== undefined && schema.interactionMode !== 'sync' && schema.interactionMode !== 'async') {
    errors.push('dslSchema.interactionMode 非法');
  }
  if (schema.primaryInput !== undefined && !isNonEmptyString(schema.primaryInput)) {
    errors.push('dslSchema.primaryInput 不能为空');
  }
  validateFieldArray('dslSchema', 'inputs', schema.inputs, errors);
  validateFieldArray('dslSchema', 'parameters', schema.parameters, errors);
  validateFieldArray('dslSchema', 'outputs', schema.outputs, errors);
  if (schema.nodeKind === 'image_generation') {
    if (!Array.isArray(schema.inputs) || schema.inputs.length === 0) errors.push('dslSchema.inputs 不能为空');
    if (!Array.isArray(schema.outputs) || schema.outputs.length === 0) errors.push('dslSchema.outputs 不能为空');
  }
  return errors;
}
