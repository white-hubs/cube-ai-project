import { createRouter, createWebHistory } from 'vue-router';
import { AgentView } from './views/AgentView';
import { FlowView } from './views/FlowView';
import { HomeView } from './views/HomeView';
import { KbView } from './views/KbView';
import { LlmView } from './views/LlmView';

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
