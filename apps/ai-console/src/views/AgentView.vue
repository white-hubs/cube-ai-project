<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { createAgenticClient } from '@cube-ai/agent-sdk-client';
import { sdkConfig } from '../config';

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
</script>

<template>
  <section class="panel">
    <h2>/agent — sessions</h2>
    <p>Status: <strong>{{ status }}</strong></p>
    <pre v-if="detail">{{ detail }}</pre>
  </section>
</template>

<style scoped>
.panel {
  max-width: 48rem;
  padding: 1rem 1.25rem;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  background: #171a21;
}
pre {
  overflow: auto;
  font-size: 0.85rem;
}
</style>
