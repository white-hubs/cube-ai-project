import { createServer } from 'node:net';

/** 在 127.0.0.1 上绑定的临时端口（用于 Engine 子进程监听）。 */
export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a && 'port' in a ? a.port : 0;
      s.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}
