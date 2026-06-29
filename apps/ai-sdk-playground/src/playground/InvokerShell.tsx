import { type PropType, defineComponent, ref, watch } from "vue";

import { runComposableCapability } from "./composable-runner";
import { defaultArgsForCapability, placementLabel } from "./invoke-args";
import { invokeCapability } from "./invoke-capability";
import { type CapabilityEntry, type CapabilityParam, type ConnectionProfile, type InvokeResult } from "./types";

function sortedParams(cap: CapabilityEntry): CapabilityParam[] {
  return [...cap.params].toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export const InvokerShell = defineComponent({
  emits: ["ran"],
  name: "InvokerShell",
  props: {
    capability: { default: null, type: Object as PropType<CapabilityEntry | null> },
    profile: { required: true, type: Object as PropType<ConnectionProfile> },
  },
  setup(props, { emit }) {
    const argsText = ref("{}");
    const file = ref<File | null>(null);
    const running = ref(false);
    const result = ref<InvokeResult | null>(null);

    watch(
      () => props.capability?.id ?? null,
      (id) => {
        if (!id || !props.capability) {
          return;
        }
        argsText.value = defaultArgsForCapability(props.capability);
        file.value = null;
        result.value = null;
      },
      { immediate: true },
    );

    async function run() {
      const cap = props.capability;
      if (!cap) {
        return;
      }
      running.value = true;
      result.value = null;
      try {
        let parsed: unknown = {};
        if (cap.kind !== "form-data") {
          parsed = argsText.value.trim() ? JSON.parse(argsText.value) : {};
        } else if (file.value) {
          const fd = new FormData();
          fd.append("file", file.value);
          parsed = { formData: fd };
        }

        if (cap.kind === "composable" || cap.kind === "mock") {
          result.value = await runComposableCapability(cap, parsed as Record<string, unknown>);
        } else {
          result.value = await invokeCapability(cap, props.profile, parsed);
        }
      } catch (e) {
        result.value = {
          ok: false,
          kind: cap.kind,
          error: e instanceof Error ? e.message : String(e),
        };
      } finally {
        running.value = false;
        emit("ran");
      }
    }

    return (): JSX.Element => {
      const cap = props.capability;
      if (!cap) {
        return (
          <section class="invoker panel">
            <p>Select a capability from the list.</p>
          </section>
        );
      }

      const params = sortedParams(cap);

      return (
        <section class="invoker panel">
          <header class="invoker__header">
            <h2>{cap.id}</h2>
            <span class="invoker__meta">
              {cap.kind} · {cap.factory}
              {cap.apiPath ? `.${cap.apiPath}` : ""}.{cap.method}
            </span>
          </header>

          {cap.description ? <p class="invoker__desc">{cap.description}</p> : null}

          {params.length > 0 ? (
            <div class="invoker__params">
              <h3>Parameters</h3>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Placement</th>
                    <th>Type</th>
                    <th>Required</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {params.map((param) => (
                    <tr key={param.name}>
                      <td>
                        <code>{param.name}</code>
                      </td>
                      <td>{placementLabel(param.placement)}</td>
                      <td>{param.type}</td>
                      <td>{param.required ? "yes" : "no"}</td>
                      <td>{param.description ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p class="invoker__hint">
                Arguments JSON uses the parameter names above as keys; values are passed to the SDK method in order. You may also use{" "}
                <code>__positional</code> as an array.
              </p>
            </div>
          ) : (
            <p class="invoker__hint">This method takes no arguments.</p>
          )}

          {cap.kind === "form-data" ? (
            <label class="invoker__file">
              File
              <input
                type="file"
                onChange={(e) => {
                  const input = e.target as HTMLInputElement;
                  file.value = input.files?.[0] ?? null;
                }}
              />
            </label>
          ) : (
            <label class="invoker__args">
              Arguments (JSON)
              <textarea
                rows={10}
                value={argsText.value}
                onInput={(e) => {
                  argsText.value = (e.target as HTMLTextAreaElement).value;
                }}
              />
            </label>
          )}

          <div class="invoker__actions">
            <button type="button" disabled={running.value} onClick={() => void run()}>
              {running.value ? "Running…" : "Run"}
            </button>
            <button
              type="button"
              onClick={() => {
                argsText.value = defaultArgsForCapability(cap);
                result.value = null;
              }}
            >
              Reset args
            </button>
          </div>

          {result.value ? (
            <div class={result.value.ok ? "invoker__result is-ok" : "invoker__result is-error"}>
              <h3>{result.value.ok ? "Result" : "Error"}</h3>
              {result.value.error ? <pre>{result.value.error}</pre> : null}
              {result.value.data !== undefined ? <pre>{JSON.stringify(result.value.data, null, 2)}</pre> : null}
              {result.value.sseEvents?.length ? <pre>{JSON.stringify(result.value.sseEvents, null, 2)}</pre> : null}
            </div>
          ) : null}
        </section>
      );
    };
  },
});
