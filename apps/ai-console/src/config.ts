const raw = import.meta.env.AI_CENTER_BASE_URL ?? 'http://localhost:3000';

export const aiCenterBaseUrl = raw.replace(/\/$/, '');

/** M5 dev identity — M6 replaces with host platform adapter headers. */
export function devAuthHeaders(): Record<string, string> {
  return {
    tenant: import.meta.env.AI_CENTER_TENANT ?? '1000000000000000001',
    terminal: import.meta.env.AI_CENTER_TERMINAL ?? 'ai-console-dev',
    authorization: `Bearer ${import.meta.env.AI_CENTER_DEV_TOKEN ?? 'dev-token'}`,
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
