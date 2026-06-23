import { defineComponent } from 'vue';
import { RouterView } from 'vue-router';

export const App = defineComponent({
  name: 'App',
  setup: () => (): JSX.Element => (
    <div class="shell">
      <header>
        <h1>AI SDK Playground</h1>
        <p class="shell__subtitle">Internal SDK capability verification harness</p>
      </header>
      <main>
        <RouterView />
      </main>
    </div>
  ),
});
