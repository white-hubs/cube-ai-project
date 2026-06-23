export interface ProxyRequestRecord {
  id: string;
  at: number;
  browserMethod: string;
  browserPath: string;
  upstreamMethod: string;
  upstreamUrl: string;
  statusCode?: number;
  error?: string;
  durationMs?: number;
}

export async function fetchProxyRequestLog(limit = 50): Promise<ProxyRequestRecord[]> {
  const res = await fetch(`/__playground/proxy-log?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`proxy-log GET failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { items: ProxyRequestRecord[] };
  return body.items;
}

export async function clearProxyRequestLog(): Promise<void> {
  const res = await fetch('/__playground/proxy-log', { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`proxy-log DELETE failed: HTTP ${res.status}`);
  }
}
