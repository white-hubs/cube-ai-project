import { describe, expect, test } from 'bun:test';
import http from 'node:http';
import {
  createPlaygroundProxyMiddleware,
  ProxyRequestLog,
  readProxyTarget,
  readSdkPathPrefix,
  writeProxyTarget,
  writeSdkPathPrefix,
} from './playground-proxy';

function listen(server: http.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('failed to bind'));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

describe('playground-proxy', () => {
  test('readProxyTarget and writeProxyTarget round-trip in memory store', () => {
    const store = { target: 'http://127.0.0.1:9000' };
    expect(readProxyTarget(store)).toBe('http://127.0.0.1:9000');
    writeProxyTarget(store, 'http://127.0.0.1:9001');
    expect(readProxyTarget(store)).toBe('http://127.0.0.1:9001');
  });

  test('writeProxyTarget keeps origin only when URL includes path', () => {
    const store = { target: '' };
    writeProxyTarget(store, 'http://192.168.0.133:40201/api');
    expect(readProxyTarget(store)).toBe('http://192.168.0.133:40201');
  });

  test('readSdkPathPrefix and writeSdkPathPrefix normalize prefix', () => {
    const store = { prefix: '' };
    writeSdkPathPrefix(store, '/api/ai-center/');
    expect(readSdkPathPrefix(store)).toBe('/api/ai-center');
  });

  test('POST /__playground/proxy-target updates target and GET returns it', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('upstream-ok');
    });
    const upstreamInfo = await listen(upstream);

    const store = { target: `http://127.0.0.1:${upstreamInfo.port}` };
    const pathPrefixStore = { prefix: '/api' };
    const middleware = createPlaygroundProxyMiddleware({
      store,
      pathPrefixStore,
    });

    const server = http.createServer((req, res) => {
      middleware(req, res, () => {
        res.writeHead(404);
        res.end('not found');
      });
    });
    const proxyInfo = await listen(server);

    const postRes = await fetch(`http://127.0.0.1:${proxyInfo.port}/__playground/proxy-target`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: `http://127.0.0.1:${upstreamInfo.port}` }),
    });
    expect(postRes.ok).toBe(true);

    const getRes = await fetch(`http://127.0.0.1:${proxyInfo.port}/__playground/proxy-target`);
    const getBody = (await getRes.json()) as { target: string };
    expect(getBody.target).toBe(`http://127.0.0.1:${upstreamInfo.port}`);

    const proxied = await fetch(`http://127.0.0.1:${proxyInfo.port}/api/health/live`);
    expect(await proxied.text()).toBe('upstream-ok');

    await proxyInfo.close();
    await upstreamInfo.close();
  });

  test('POST /__playground/path-prefix updates prefix and forwards full browser path', async () => {
    let upstreamPath = '';
    const upstream = http.createServer((req, res) => {
      upstreamPath = req.url ?? '';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('prefixed-ok');
    });
    const upstreamInfo = await listen(upstream);

    const store = { target: `http://127.0.0.1:${upstreamInfo.port}` };
    const pathPrefixStore = { prefix: '/api' };
    const middleware = createPlaygroundProxyMiddleware({
      store,
      pathPrefixStore,
    });

    const server = http.createServer((req, res) => {
      middleware(req, res, () => {
        res.writeHead(404);
        res.end('not found');
      });
    });
    const proxyInfo = await listen(server);

    const postRes = await fetch(`http://127.0.0.1:${proxyInfo.port}/__playground/path-prefix`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: '/api/ai-center' }),
    });
    expect(postRes.ok).toBe(true);

    const proxied = await fetch(`http://127.0.0.1:${proxyInfo.port}/api/ai-center/health/live`);
    expect(await proxied.text()).toBe('prefixed-ok');
    expect(upstreamPath).toBe('/api/ai-center/health/live');

    await proxyInfo.close();
    await upstreamInfo.close();
  });

  test('proxied request is recorded with browser and upstream method/path', async () => {
    let upstreamMethod = '';
    let upstreamPath = '';
    const upstream = http.createServer((req, res) => {
      upstreamMethod = req.method ?? '';
      upstreamPath = req.url ?? '';
      res.writeHead(201, { 'content-type': 'text/plain' });
      res.end('created');
    });
    const upstreamInfo = await listen(upstream);

    const store = { target: `http://127.0.0.1:${upstreamInfo.port}` };
    const pathPrefixStore = { prefix: '/api' };
    const requestLog = new ProxyRequestLog();
    const middleware = createPlaygroundProxyMiddleware({
      store,
      pathPrefixStore,
      requestLog,
    });

    const server = http.createServer((req, res) => {
      middleware(req, res, () => {
        res.writeHead(404);
        res.end('not found');
      });
    });
    const proxyInfo = await listen(server);

    const proxied = await fetch(`http://127.0.0.1:${proxyInfo.port}/api/kb/search?q=hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'hello' }),
    });
    expect(proxied.status).toBe(201);

    const logRes = await fetch(`http://127.0.0.1:${proxyInfo.port}/__playground/proxy-log`);
    const logBody = (await logRes.json()) as {
      items: Array<{
        browserMethod: string;
        browserPath: string;
        upstreamMethod: string;
        upstreamUrl: string;
        statusCode?: number;
      }>;
    };

    expect(logBody.items).toHaveLength(1);
    expect(logBody.items[0]?.browserMethod).toBe('POST');
    expect(logBody.items[0]?.browserPath).toBe('/api/kb/search?q=hello');
    expect(logBody.items[0]?.upstreamMethod).toBe('POST');
    expect(logBody.items[0]?.upstreamUrl).toBe(
      `http://127.0.0.1:${upstreamInfo.port}/api/kb/search?q=hello`,
    );
    expect(logBody.items[0]?.statusCode).toBe(201);
    expect(upstreamMethod).toBe('POST');
    expect(upstreamPath).toBe('/api/kb/search?q=hello');

    await proxyInfo.close();
    await upstreamInfo.close();
  });
});
