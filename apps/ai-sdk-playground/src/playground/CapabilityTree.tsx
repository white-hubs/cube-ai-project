import { defineComponent, ref, computed, onMounted, type PropType } from 'vue';
import type { CapabilityEntry } from './types';
import manifest from '../generated/capabilities.json';

export const CapabilityTree = defineComponent({
  name: 'CapabilityTree',
  props: {
    selectedId: { type: String as PropType<string | null>, default: null },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const filter = ref('');
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
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    });

    onMounted(() => {
      if (!props.selectedId && entries[0]) {
        emit('select', entries[0].id);
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
                  <button
                    type="button"
                    class={props.selectedId === item.id ? 'is-active' : ''}
                    onClick={() => emit('select', item.id)}
                  >
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
