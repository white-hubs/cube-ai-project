import { defineComponent, ref, computed, onMounted, watch } from 'vue';
import type { CapabilityEntry, ConnectionProfile } from './types';
import manifest from '../generated/capabilities.json';
import { CapabilityTree } from './CapabilityTree';
import { ConnectionProfilePanel } from './ConnectionProfilePanel';
import { InvokerShell } from './InvokerShell';
import { loadConnectionProfile } from './connection-profile';
import { ProxyRequestLogPanel } from './ProxyRequestLogPanel';

async function probeHealth(prefix: string): Promise<string> {
  const base = prefix.replace(/\/$/, '');
  const res = await fetch(`${base}/health/live`);
  return res.ok ? `ok (${res.status})` : `HTTP ${res.status}`;
}

export const PlaygroundView = defineComponent({
  name: 'PlaygroundView',
  setup() {
    const selectedId = ref<string | null>(null);
    const profile = ref<ConnectionProfile>(loadConnectionProfile());
    const health = ref('checking…');
    const logRefreshToken = ref(0);

    const selectedCapability = computed(() =>
      (manifest.entries as CapabilityEntry[]).find((e) => e.id === selectedId.value) ?? null,
    );

    const healthPath = computed(
      () => `${profile.value.sdkPathPrefix.replace(/\/$/, '')}/health/live`,
    );

    async function refreshHealth() {
      health.value = 'checking…';
      try {
        health.value = await probeHealth(profile.value.sdkPathPrefix);
      } catch (e) {
        health.value = e instanceof Error ? e.message : String(e);
      }
    }

    onMounted(() => {
      void refreshHealth();
    });

    watch(
      () => profile.value.sdkPathPrefix,
      () => {
        void refreshHealth();
      },
    );

    return (): JSX.Element => (
      <div class="playground">
        <ConnectionProfilePanel
          onChange={(next: ConnectionProfile) => {
            profile.value = next;
          }}
        />
        <p class="playground__health">
          Health <code>{healthPath.value}</code>: <strong>{health.value}</strong>
        </p>
        <ProxyRequestLogPanel refreshToken={logRefreshToken.value} />
        <div class="playground__body">
          <CapabilityTree
            selectedId={selectedId.value}
            onSelect={(id: string) => {
              selectedId.value = id;
            }}
          />
          <InvokerShell
            capability={selectedCapability.value}
            profile={profile.value}
            onRan={() => {
              logRefreshToken.value += 1;
            }}
          />
        </div>
      </div>
    );
  },
});
