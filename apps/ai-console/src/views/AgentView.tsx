import { createAgenticClient } from '@cube-ai/agent-sdk-client';
import { defineComponent, onMounted, ref } from 'vue';
import { sdkConfig } from '../config';

export const AgentView = defineComponent({
  name: 'AgentView',
  setup() {
    const status = ref('idle');
    const detail = ref('');

    onMounted(async () => {
      status.value = 'loading';
      const client = createAgenticClient({
        baseUrl: sdkConfig().baseUrl,
        auth: { provider: () => sdkConfig().headers().authorization.replace(/^Bearer /, '') },
        headersProvider: () => {
          const h = sdkConfig().headers();
          return { tenant: h.tenant, terminal: h.terminal };
        },
      });
      try {
        const page = await client.sessions.list({ limit: 1 });
        status.value = 'ok';
        detail.value = JSON.stringify(page, null, 2);
      } catch (e) {
        status.value = 'error';
        detail.value = e instanceof Error ? e.message : String(e);
      }
    });

    return (): JSX.Element => (
      <section class="panel">
        <h2>/agent — sessions</h2>
        <p>
          Status: <strong>{status.value}</strong>
        </p>
        {detail.value ? <pre>{detail.value}</pre> : null}
      </section>
    );
  },
});
