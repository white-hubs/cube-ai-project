import { createKbConsoleClient } from '@cube-ai/kb-sdk-console';
import { defineComponent, onMounted, ref } from 'vue';
import { sdkConfig } from '../config';

export const KbView = defineComponent({
  name: 'KbView',
  setup() {
    const status = ref('idle');
    const detail = ref('');

    onMounted(async () => {
      status.value = 'loading';
      const client = createKbConsoleClient(sdkConfig());
      try {
        const docs = await client.listDocuments();
        status.value = 'ok';
        detail.value = JSON.stringify(docs, null, 2);
      } catch (e) {
        status.value = 'error';
        detail.value = e instanceof Error ? e.message : String(e);
      }
    });

    return (): JSX.Element => (
      <section class="panel">
        <h2>/kb — documents</h2>
        <p>
          Status: <strong>{status.value}</strong>
        </p>
        {detail.value ? <pre>{detail.value}</pre> : null}
      </section>
    );
  },
});
