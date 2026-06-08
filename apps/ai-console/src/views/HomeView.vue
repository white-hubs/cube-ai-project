<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { aiCenterBaseUrl } from '../config';

const health = ref<string>('checking…');

onMounted(async () => {
  try {
    const res = await fetch(`${aiCenterBaseUrl}/health`);
    health.value = res.ok ? `ok (${res.status})` : `HTTP ${res.status}`;
  } catch (e) {
    health.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <section class="panel">
    <h2>Single origin</h2>
    <p><code>{{ aiCenterBaseUrl }}</code></p>
    <p>Health: <strong>{{ health }}</strong></p>
    <p>Use the nav to open each domain smoke page.</p>
  </section>
</template>

<style scoped>
.panel {
  max-width: 40rem;
  padding: 1rem 1.25rem;
  border: 1px solid #2a2f3a;
  border-radius: 8px;
  background: #171a21;
}
code {
  word-break: break-all;
}
</style>
