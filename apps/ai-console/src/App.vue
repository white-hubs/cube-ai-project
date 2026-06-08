<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
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
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
}
header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #2a2f3a;
  display: flex;
  gap: 1.5rem;
  align-items: center;
}
h1 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}
nav {
  display: flex;
  gap: 1rem;
}
nav a.router-link-active {
  color: #fff;
  font-weight: 600;
}
main {
  padding: 1.5rem;
}
</style>
