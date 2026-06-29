import vueJsx from "@vitejs/plugin-vue-jsx";
import { defineConfig, loadEnv } from "vite";

import { playgroundProxyVitePlugin } from "./src/vite-plugins/playground-proxy";

const DEFAULT_PROXY_TARGET = "https://ai-center-prebuilt.cube-ai-project.orb.local";
const DEFAULT_SDK_PATH_PREFIX = "/api";

function normalizeProxyOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`;
  } catch {
    return trimmed.replace(/\/$/u, "");
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = normalizeProxyOrigin(env.AI_CENTER_BASE_URL || DEFAULT_PROXY_TARGET);
  const defaultPathPrefix = env.AI_SDK_PATH_PREFIX || DEFAULT_SDK_PATH_PREFIX;

  return {
    build: {
      emptyOutDir: true,
      outDir: "dist",
    },
    plugins: [
      vueJsx(),
      playgroundProxyVitePlugin({
        defaultTarget: proxyTarget,
        defaultPathPrefix,
      }),
    ],
    server: {
      host: "0.0.0.0",
      port: Number(env.AI_PLAYGROUND_PORT || 5173),
    },
  };
});
