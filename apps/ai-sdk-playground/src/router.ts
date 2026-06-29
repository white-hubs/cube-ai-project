import { createRouter, createWebHistory } from "vue-router";

import { PlaygroundView } from "./playground/PlaygroundView";

export const router = createRouter({
  history: createWebHistory(),
  routes: [{ component: PlaygroundView, path: "/" }],
});
