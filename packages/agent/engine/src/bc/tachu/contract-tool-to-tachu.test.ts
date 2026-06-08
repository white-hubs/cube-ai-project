import { describe, expect, test } from 'bun:test';
import type { ToolDescriptor as CubeToolDescriptor } from '@cube-ai/contracts';
import { mapContractToolToTachu } from './contract-tool-to-tachu';

function makeDescriptor(override: Partial<CubeToolDescriptor> = {}): CubeToolDescriptor {
  return {
    schemaVersion: 1,
    kind: 'TOOL',
    name: 'platform.image.describe',
    displayName: '描述图片',
    isPreset: true,
    version: '1.0.0',
    meta: {
      execution: 'LOCAL',
      consent: 'NEVER',
      requiresPrincipal: 'USER',
      timeoutMs: 15000,
      idempotent: true,
      sideEffects: ['read:platform.image'],
    },
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    requires: { principal: 'USER', oauthScope: [], obo: { audience: 'app.image' } },
    execute: 'builtin:platform.image.describe',
    ...override,
  } as CubeToolDescriptor;
}

describe('mapContractToolToTachu consumes forwarding (ADR-0026)', () => {
  test('omits consumes when not declared', () => {
    const mapped = mapContractToolToTachu(makeDescriptor());
    expect(mapped.consumes).toBeUndefined();
  });

  test('forwards kinds as a ReadonlySet and required flag', () => {
    const mapped = mapContractToolToTachu(
      makeDescriptor({ consumes: { kinds: ['image', 'file'], required: true } }),
    );
    expect(mapped.consumes?.kinds).toBeInstanceOf(Set);
    expect([...(mapped.consumes?.kinds ?? [])].sort()).toEqual(['file', 'image']);
    expect(mapped.consumes?.required).toBe(true);
  });

  test('forwards required-only consumes (no kinds)', () => {
    const mapped = mapContractToolToTachu(makeDescriptor({ consumes: { required: false } }));
    expect(mapped.consumes).toEqual({ required: false });
  });

  test('drops empty kinds array with no required as undefined', () => {
    const mapped = mapContractToolToTachu(makeDescriptor({ consumes: { kinds: [] } }));
    expect(mapped.consumes).toBeUndefined();
  });
});
