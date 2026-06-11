/** Same-origin API prefix; Vite dev server proxies `/api` → `AI_CENTER_BASE_URL`. */
export const aiCenterBaseUrl = '/api';

function viteEnv(name: 'VITE_AI_CENTER_TENANT' | 'VITE_AI_CENTER_TERMINAL' | 'VITE_AI_CENTER_DEV_TOKEN', fallback: string): string {
  const value = import.meta.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** M5 dev identity — M6 replaces with host platform adapter headers. */
export function devAuthHeaders(): Record<string, string> {
  return {
    tenant: viteEnv('VITE_AI_CENTER_TENANT', '1000000000000000001'),
    terminal: viteEnv('VITE_AI_CENTER_TERMINAL', 'ai-console-dev'),
    authorization: `Bearer ${viteEnv('VITE_AI_CENTER_DEV_TOKEN', 'dev-token')}`,
  };
}

/**
 * Single-origin SDK config. Agent consumption uses engine `/v1/*` (ADR-0008 addendum);
 * `/agent` is vue-router UI only — never an HTTP pathPrefix.
 */
export function sdkConfig() {
  return {
    baseUrl: aiCenterBaseUrl,
    headers: devAuthHeaders,
  };
}
