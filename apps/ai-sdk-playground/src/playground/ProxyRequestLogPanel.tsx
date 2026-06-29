import { defineComponent, onMounted, onUnmounted, ref, watch } from "vue";

import { type ProxyRequestRecord, clearProxyRequestLog, fetchProxyRequestLog } from "./proxy-request-log";

export const ProxyRequestLogPanel = defineComponent({
  name: "ProxyRequestLogPanel",
  props: {
    refreshToken: { default: 0, type: Number },
  },
  setup(props) {
    const items = ref<ProxyRequestRecord[]>([]);
    const error = ref("");
    let timer: ReturnType<typeof setInterval> | undefined;

    async function reload() {
      try {
        items.value = await fetchProxyRequestLog(30);
        error.value = "";
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
      }
    }

    async function clearLog() {
      await clearProxyRequestLog();
      await reload();
    }

    onMounted(() => {
      void reload();
      timer = setInterval(() => void reload(), 1500);
    });

    onUnmounted(() => {
      if (timer) {
        clearInterval(timer);
      }
    });

    watch(
      () => props.refreshToken,
      () => {
        void reload();
      },
    );

    return (): JSX.Element => (
      <section class="proxy-log panel">
        <header class="proxy-log__header">
          <h2>Proxy request log</h2>
          <button type="button" onClick={() => void clearLog()}>
            Clear
          </button>
          <button type="button" onClick={() => void reload()}>
            Refresh
          </button>
        </header>
        <p class="proxy-log__hint">Browser path → upstream method + full URL after proxy rewrite.</p>
        {error.value ? <p class="proxy-log__error">{error.value}</p> : null}
        {items.value.length === 0 ? (
          <p class="proxy-log__empty">No proxied requests yet.</p>
        ) : (
          <div class="proxy-log__table-wrap">
            <table class="proxy-log__table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Browser</th>
                  <th>Upstream</th>
                  <th>Status</th>
                  <th>ms</th>
                </tr>
              </thead>
              <tbody>
                {items.value.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.at).toLocaleTimeString()}</td>
                    <td>
                      <code>
                        {item.browserMethod} {item.browserPath}
                      </code>
                    </td>
                    <td>
                      <code>
                        {item.upstreamMethod} {item.upstreamUrl}
                      </code>
                    </td>
                    <td>{item.error ? `ERR ${item.error}` : (item.statusCode ?? "…")}</td>
                    <td>{item.durationMs ?? "…"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  },
});
