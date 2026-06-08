<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { createKbConsoleClient } from '@cube-ai/kb-sdk-console';
import { sdkConfig } from '../config';

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
</script>

<template>
  <section class="panel">
    <h2>/kb — documents</h2>
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
