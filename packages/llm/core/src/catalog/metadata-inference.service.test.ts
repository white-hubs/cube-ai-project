import { describe, expect, test } from 'bun:test';
import { ModelMetadataInferenceService } from './metadata-inference.service';

function requireCandidate<T>(candidate: T | undefined): T {
  expect(candidate).toBeDefined();
  return candidate!;
}

describe('ModelMetadataInferenceService', () => {
  test('prefers exact system model metadata when model code matches', async () => {
    const service = new ModelMetadataInferenceService({
      listActiveProviders: async () => [
        {
          id: '1',
          provider_code: 'openai-official',
          type_code: 'openai',
        },
      ],
      listActiveModels: async () => [
        {
          id: '2',
          system_provider_id: '1',
          model_code: 'gpt-4o',
          display_name: 'GPT-4o',
          group_name: 'GPT-4o',
          icon_url: null,
          api_base_url: null,
          endpoint_type: 'openai',
          model_types: 'reasoning,tool',
          is_free: false,
          supports_test: true,
        },
      ],
      listActiveRules: async () => [
        {
          id: '5',
          provider_type_code: null,
          provider_code: null,
          match_type: 'prefix',
          pattern: 'gpt-',
          normalized_name: 'GPT',
          native_family: null,
          display_name_template: 'GPT',
          group_name: 'GPT',
          icon_url: null,
          api_base_url: null,
          endpoint_type: 'openai',
          request_schema_json:
            '{"requestShape":"openai_chat_compatible","extraBodyFields":[{"key":"enable_thinking","type":"boolean"}]}',
          response_schema_json:
            '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content"}}',
          dsl_schema_json: '{"nodeKind":"language_model","interactionMode":"sync"}',
          model_types: 'reasoning,tool',
          is_free: false,
          priority: '90',
        },
      ],
    });

    const candidate = requireCandidate(
      (
        await service.inferRemoteModels(
          {
            typeCode: 'openai',
            providerCode: 'openai-official',
            iconUrl: null,
            systemProviderId: '1',
          },
          [{ modelCode: 'gpt-4o', displayName: 'gpt-4o', groupName: 'General' }],
        )
      )[0],
    );

    expect(candidate.modelCode).toBe('gpt-4o');
    expect(candidate.displayName).toBe('GPT-4o');
    expect(candidate.modelTypes).toEqual(['reasoning', 'tool']);
    expect(candidate.endpointType).toBe('openai');
    expect(candidate.matchedBy).toBe('system-model');
    expect(candidate.systemModelId).toBe('2');
  });

  test('matchRule supports prefix/contains/regex', () => {
    const service = new ModelMetadataInferenceService({
      listActiveProviders: async () => [],
      listActiveModels: async () => [],
      listActiveRules: async () => [],
    });
    const rules = [
      {
        id: '1',
        provider_type_code: 'openai',
        provider_code: null,
        match_type: 'prefix' as const,
        pattern: 'gpt-',
        normalized_name: null,
        native_family: null,
        display_name_template: null,
        group_name: null,
        icon_url: null,
        api_base_url: null,
        endpoint_type: 'openai' as const,
        request_schema_json: null,
        response_schema_json: null,
        dsl_schema_json: null,
        model_types: 'chat',
        is_free: false,
        priority: '10',
      },
    ];
    const ctx = { typeCode: 'openai', providerCode: 'openai-official', iconUrl: null, systemProviderId: null };
    expect(service.matchRule(ctx, 'gpt-4o-mini', rules)?.match_type).toBe('prefix');
    expect(service.matchRule(ctx, 'claude-3', rules)).toBeNull();
  });
});
