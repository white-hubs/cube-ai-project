import { defineComponent } from 'vue';
import { RouterLink, RouterView } from 'vue-router';

export const App = defineComponent({
  name: 'App',
  setup: () => (): JSX.Element => (
    <div class="shell">
      <header>
        <h1>AI Console</h1>
        <nav>
          <RouterLink to="/">Home</RouterLink>
          <RouterLink to="/agent">Agent</RouterLink>
          <RouterLink to="/flow">Flow</RouterLink>
          <RouterLink to="/kb">KB</RouterLink>
          <RouterLink to="/llm">LLM</RouterLink>
        </nav>
      </header>
      <main>
        <RouterView />
      </main>
    </div>
  ),
});
