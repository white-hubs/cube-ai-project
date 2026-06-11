import { createFlowConsoleClient } from '@cube-ai/flow-sdk-console';
import { defineComponent, onMounted, ref } from 'vue';
import { sdkConfig } from '../config';

export const FlowView = defineComponent({
  name: 'FlowView',
  setup() {
    const status = ref('idle');
    const detail = ref('');

    onMounted(async () => {
      status.value = 'loading';
      const client = createFlowConsoleClient(sdkConfig());
      try {
        const flows = await client.listFlows();
        status.value = 'ok';
        detail.value = JSON.stringify(flows, null, 2);
      } catch (e) {
        status.value = 'error';
        detail.value = e instanceof Error ? e.message : String(e);
      }
    });

    return (): JSX.Element => (
      <section class="panel">
        <h2>/flow — list flows</h2>
        <p>
          Status: <strong>{status.value}</strong>
        </p>
        {detail.value ? <pre>{detail.value}</pre> : null}
      </section>
    );
  },
});
