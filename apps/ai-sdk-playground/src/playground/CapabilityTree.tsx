import { type PropType, computed, defineComponent, onMounted, ref } from "vue";

import manifest from "../generated/capabilities.json";
import { type CapabilityEntry } from "./types";

export const CapabilityTree = defineComponent({
  emits: ["select"],
  name: "CapabilityTree",
  props: {
    selectedId: { default: null, type: String as PropType<string | null> },
  },
  setup(props, { emit }) {
    const filter = ref("");
    const entries = manifest.entries as CapabilityEntry[];

    const grouped = computed(() => {
      const q = filter.value.trim().toLowerCase();
      const map = new Map<string, CapabilityEntry[]>();
      for (const entry of entries) {
        if (q && !entry.id.toLowerCase().includes(q) && !entry.package.toLowerCase().includes(q)) {
          continue;
        }
        const key = entry.package;
        const list = map.get(key) ?? [];
        list.push(entry);
        map.set(key, list);
      }
      return [...map.entries()].toSorted(([a], [b]) => a.localeCompare(b));
    });

    onMounted(() => {
      if (!props.selectedId && entries[0]) {
        emit("select", entries[0].id);
      }
    });

    return (): JSX.Element => (
      <aside class="cap-tree">
        <input
          class="cap-tree__filter"
          placeholder="Filter capabilities…"
          value={filter.value}
          onInput={(e) => {
            filter.value = (e.target as HTMLInputElement).value;
          }}
        />
        {grouped.value.map(([pkg, items]) => (
          <section key={pkg} class="cap-tree__group">
            <h3>{pkg}</h3>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" class={props.selectedId === item.id ? "is-active" : ""} onClick={() => emit("select", item.id)}>
                    <span class="cap-tree__kind">{item.kind}</span>
                    {item.id}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </aside>
    );
  },
});
