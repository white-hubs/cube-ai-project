import { describe, expect, it } from "bun:test";

import { OpenAiCompatibleConnectivityAdapter } from "./connectivity/adapters";
import { InMemoryCatalogStore } from "./in-memory-catalog.store";
import { ModelMetadataInferenceService } from "./metadata-inference.service";
import { LlmRemoteSyncService } from "./remote-sync.service";

describe("LlmRemoteSyncService", () => {
  it("fetchRemoteModels + infer + upsert tenant models (fetch stub)", async () => {
    const tenant = 3003;
    const store = new InMemoryCatalogStore({
      tenantProviders: [
        {
          api_base_url: "https://api.example.com/v1",
          api_key: "sk-test",
          enabled: true,
          icon_url: null,
          id: "tp1",
          is_custom: true,
          name: "OpenAI",
          provider_code: "openai-official",
          remark: null,
          system_provider_id: null,
          tenant,
          type_code: "openai",
        },
      ],
    });
    const inference = new ModelMetadataInferenceService({
      listActiveModels: async () => [],
      listActiveProviders: async () => [],
      listActiveRules: async () => [],
    });
    const sync = new LlmRemoteSyncService(store, inference, [
      new OpenAiCompatibleConnectivityAdapter((async () => Response.json({ data: [{ id: "gpt-4o-mini" }] })) as unknown as typeof fetch),
    ]);
    const upserted = await sync.syncRemoteModelsForTenantProvider(tenant, "tp1");
    expect(upserted).toBe(1);
    const models = store.listTenantModelsByProvider(tenant, "tp1");
    expect(models.find((m) => m.model_code === "gpt-4o-mini")?.display_name).toBe("Gpt 4o Mini");
  });
});
