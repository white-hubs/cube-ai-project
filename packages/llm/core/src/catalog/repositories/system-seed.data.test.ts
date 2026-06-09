import { describe, expect, it } from 'bun:test';
import { AUTHORITATIVE_SYSTEM_CATALOG_SEED } from './system-seed.data';

describe('AUTHORITATIVE_SYSTEM_CATALOG_SEED', () => {
  it('every provider references an existing type_code', () => {
    const types = new Set((AUTHORITATIVE_SYSTEM_CATALOG_SEED.types ?? []).map((t) => t.code));
    for (const p of AUTHORITATIVE_SYSTEM_CATALOG_SEED.providers ?? []) {
      expect(types.has(p.type_code)).toBe(true);
    }
  });

  it('every model references an existing provider id and has endpoint_type', () => {
    const providerIds = new Set((AUTHORITATIVE_SYSTEM_CATALOG_SEED.providers ?? []).map((p) => p.id));
    for (const m of AUTHORITATIVE_SYSTEM_CATALOG_SEED.models ?? []) {
      expect(providerIds.has(m.system_provider_id)).toBe(true);
      expect(typeof m.endpoint_type).toBe('string');
      expect((m.endpoint_type as string).length).toBeGreaterThan(0);
    }
  });

  it('match rules reference known endpoint_type values', () => {
    const known = new Set(['openai','openai_response','anthropic','gemini','azure_openai','new_api','openai_image','jina_rerank','ollama','geekai','dashscope','dashscope_text2image','volcengine_ark']);
    for (const r of AUTHORITATIVE_SYSTEM_CATALOG_SEED.matchRules ?? []) {
      expect(known.has(r.endpoint_type as string)).toBe(true);
    }
  });
});
