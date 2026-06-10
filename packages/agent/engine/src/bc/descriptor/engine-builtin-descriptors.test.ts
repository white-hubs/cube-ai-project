import { describe, expect, test } from 'bun:test';
import { buildImageQwenDescriptor, buildPlatformToolDescriptors } from './engine-builtin-descriptors';

describe('engine builtin descriptors', () => {
  test('image.qwen descriptor parses and pins execute ref', () => {
    const d = buildImageQwenDescriptor();
    expect(d.name).toBe('image.qwen');
    expect(d.execute).toBe('builtin:engine.image_qwen');
    expect(d.handler?.kind).toBe('qwenImage');
    expect(d.description).toContain('NOT for understanding or describing images');
  });

  test('platform.flow.invoke descriptor exposes flowId and variables', () => {
    const invoke = buildPlatformToolDescriptors().find((d) => d.name === 'platform.flow.invoke');
    expect(invoke).toBeDefined();
    const schema = invoke!.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toContain('flowId');
    expect(schema.properties).toHaveProperty('flowId');
    expect(schema.properties).toHaveProperty('variables');
    expect(schema.properties).not.toHaveProperty('flowCode');
    const vars = schema.properties!.variables as { description?: string; properties?: Record<string, unknown> };
    expect(vars.description).toContain('input');
    expect(vars.properties).toHaveProperty('input');
    expect(invoke!.description).toContain('variables.input');
  });
});
