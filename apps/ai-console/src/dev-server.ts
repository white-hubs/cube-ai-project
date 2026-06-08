import index from '../index.html';

const port = Number(process.env.AI_CONSOLE_PORT ?? 5173);

const server = Bun.serve({
  port,
  routes: {
    '/*': index,
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`ai-console dev → http://localhost:${server.port}`);
