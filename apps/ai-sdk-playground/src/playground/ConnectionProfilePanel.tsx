import { defineComponent, ref, onMounted, watch } from 'vue';
import {
  DEFAULT_CONNECTION_PROFILE,
  loadConnectionProfile,
  saveConnectionProfile,
  fetchProxyTarget,
  fetchSdkPathPrefix,
  applyConnectionSettings,
} from './connection-profile';

export const ConnectionProfilePanel = defineComponent({
  name: 'ConnectionProfilePanel',
  emits: ['change'],
  setup(_, { emit }) {
    const profile = ref(loadConnectionProfile());
    const serverProxyTarget = ref('');
    const serverSdkPathPrefix = ref('');
    const status = ref('');

    async function refreshServerState() {
      const [target, prefix] = await Promise.all([fetchProxyTarget(), fetchSdkPathPrefix()]);
      serverProxyTarget.value = target;
      serverSdkPathPrefix.value = prefix;
    }

    onMounted(async () => {
      try {
        if (profile.value.proxyTarget.trim() || profile.value.sdkPathPrefix.trim()) {
          status.value = 'Restoring saved connection…';
          profile.value = await applyConnectionSettings(profile.value);
          await refreshServerState();
          status.value = `Upstream ${profile.value.proxyTarget || '(none)'} · prefix ${profile.value.sdkPathPrefix || '(none)'}`;
          emit('change', profile.value);
          return;
        }
        await refreshServerState();
      } catch (e) {
        status.value = e instanceof Error ? e.message : String(e);
      }
    });

    watch(
      profile,
      (next) => {
        saveConnectionProfile(next);
        emit('change', next);
      },
      { deep: true },
    );

    async function applyConnection() {
      status.value = 'Applying connection…';
      try {
        profile.value = await applyConnectionSettings(profile.value);
        await refreshServerState();
        status.value = `Saved · upstream ${profile.value.proxyTarget} · prefix ${profile.value.sdkPathPrefix}`;
        emit('change', profile.value);
      } catch (e) {
        status.value = e instanceof Error ? e.message : String(e);
      }
    }

    function resetDefaults() {
      profile.value = { ...DEFAULT_CONNECTION_PROFILE };
      void refreshServerState();
    }

    return (): JSX.Element => (
      <section class="profile panel">
        <h2>Connection profile</h2>
        <div class="profile__grid">
          <label>
            SDK path prefix
            <input
              value={profile.value.sdkPathPrefix}
              placeholder={serverSdkPathPrefix.value || '/your-prefix'}
              onInput={(e) => {
                profile.value.sdkPathPrefix = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            Upstream origin
            <input
              value={profile.value.proxyTarget}
              placeholder={serverProxyTarget.value || 'http://host:port'}
              onInput={(e) => {
                profile.value.proxyTarget = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            tenant
            <input
              value={profile.value.headers.tenant ?? ''}
              onInput={(e) => {
                profile.value.headers.tenant = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label>
            terminal
            <input
              value={profile.value.headers.terminal ?? ''}
              onInput={(e) => {
                profile.value.headers.terminal = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label class="profile__wide">
            authorization
            <input
              value={profile.value.headers.authorization ?? ''}
              onInput={(e) => {
                profile.value.headers.authorization = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
        </div>
        <div class="profile__actions">
          <button type="button" onClick={() => void applyConnection()}>
            Apply connection
          </button>
          <button type="button" onClick={resetDefaults}>
            Reset defaults
          </button>
          <span class="profile__status">{status.value}</span>
        </div>
      </section>
    );
  },
});
