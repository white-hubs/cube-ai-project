import { ref, type Ref } from 'vue';
import type { AgenticClient } from '@cube-ai/agent-sdk-client';
import { AgenticClientError } from '@cube-ai/agent-sdk-client';
import type { PublicToolDescriptor } from '@cube-ai/contracts';

/**
 * Reactive tool descriptor list.
 * Ref: docs/detailed-design/08-sdk/sdk-vue.md §2.2
 */
export function useTools(
  client: AgenticClient,
): {
  descriptors: Ref<PublicToolDescriptor[]>;
  loading:     Ref<boolean>;
  error:       Ref<AgenticClientError | null>;
  reload:      () => Promise<void>;
} {
  const descriptors = ref<PublicToolDescriptor[]>([]);
  const loading     = ref(false);
  const error       = ref<AgenticClientError | null>(null);

  const reload = async () => {
    loading.value = true;
    error.value   = null;
    try {
      descriptors.value = await client.tools.list();
    } catch (e) {
      error.value = e instanceof AgenticClientError ? e : new AgenticClientError(
        null, null, String(e), null, null, Date.now(),
      );
    } finally {
      loading.value = false;
    }
  };

  return { descriptors: descriptors as Ref<PublicToolDescriptor[]>, loading, error, reload };
}
