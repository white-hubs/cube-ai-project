import { createLlmConsoleClient } from '@cube-ai/llm-sdk-console';
import { defineComponent, onMounted, ref } from 'vue';
import { sdkConfig } from '../config';

export const LlmView = defineComponent({
  name: 'LlmView',
  setup() {
    const status = ref('idle');
    const detail = ref('');

    onMounted(async () => {
      status.value = 'loading';
      const client = createLlmConsoleClient(sdkConfig());
      try {
        const providers = await client.listProviders();
        status.value = 'ok';
        detail.value = JSON.stringify(providers, null, 2);
      } catch (e) {
        status.value = 'error';
        detail.value = e instanceof Error ? e.message : String(e);
      }
    });

    return (): JSX.Element => (
      <section class="panel">
        <h2>/llm — providers</h2>
        <p>
          Status: <strong>{status.value}</strong>
        </p>
        {detail.value ? <pre>{detail.value}</pre> : null}
      </section>
    );
  },
});
