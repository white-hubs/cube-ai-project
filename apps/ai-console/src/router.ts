import { createRouter, createWebHistory } from 'vue-router';
import AgentView from './views/AgentView.vue';
import FlowView from './views/FlowView.vue';
import KbView from './views/KbView.vue';
import LlmView from './views/LlmView.vue';
import HomeView from './views/HomeView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/agent', component: AgentView },
    { path: '/flow', component: FlowView },
    { path: '/kb', component: KbView },
    { path: '/llm', component: LlmView },
  ],
});
