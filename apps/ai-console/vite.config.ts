import vueJsx from '@vitejs/plugin-vue-jsx';
import { defineConfig, loadEnv } from 'vite';

const DEFAULT_PROXY_TARGET = 'https://ai-center-prebuilt.cube-ai-project.orb.local';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = (env.AI_CENTER_BASE_URL || DEFAULT_PROXY_TARGET).replace(/\/$/, '');

  return {
    plugins: [vueJsx()],
    server: {
      host: '0.0.0.0',
      port: Number(env.AI_CONSOLE_PORT || 5173),
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
