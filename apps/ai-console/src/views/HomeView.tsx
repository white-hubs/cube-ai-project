import { defineComponent, onMounted, ref } from 'vue';
import { aiCenterBaseUrl } from '../config';

export const HomeView = defineComponent({
  name: 'HomeView',
  setup() {
    const health = ref<string>('checking…');

    onMounted(async () => {
      try {
        const res = await fetch(`${aiCenterBaseUrl}/health/live`);
        health.value = res.ok ? `ok (${res.status})` : `HTTP ${res.status}`;
      } catch (e) {
        health.value = e instanceof Error ? e.message : String(e);
      }
    });

    return (): JSX.Element => (
      <section class="panel">
        <h2>Single origin</h2>
        <p>
          <code>{aiCenterBaseUrl}</code>
        </p>
        <p>
          Health: <strong>{health.value}</strong>
        </p>
        <p>Use the nav to open each domain smoke page.</p>
      </section>
    );
  },
});
