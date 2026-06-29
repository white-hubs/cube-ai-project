import type { ConnectionProfile } from "./types";

export const PROFILE_STORAGE_KEY = "ai-sdk-playground.profile";

export const DEFAULT_CONNECTION_PROFILE: ConnectionProfile = {
  headers: {
    authorization: `Bearer ${import.meta.env.VITE_AI_CENTER_DEV_TOKEN ?? "dev-token"}`,
    tenant: import.meta.env.VITE_AI_CENTER_TENANT ?? "1000000000000000001",
    terminal: import.meta.env.VITE_AI_CENTER_TERMINAL ?? "ai-sdk-playground-dev",
  },
  pathPrefixOverrides: {},
  proxyTarget: "",
  sdkPathPrefix: import.meta.env.VITE_SDK_PATH_PREFIX ?? "/api",
};

const DOMAIN_SUFFIX: Record<string, { client: string; console: string }> = {
  agent: { client: "/agent", console: "" },
  flow: { client: "", console: "" },
  kb: { client: "", console: "" },
  llm: { client: "", console: "" },
};

const DEFAULT_PATH_PREFIX: Record<string, string | undefined> = {
  "agent-console": "/agent/console",
  "flow-client": "/flow",
  "flow-console": "/flow/console",
  "kb-client": "/kb",
  "kb-console": "/kb/console",
  "llm-console": "/llm/console",
};

/** Normalize user SDK path prefix — leading slash, no trailing slash. */
export function normalizeSdkPathPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/$/u, "");
}

/** Keep origin only — strip any path/query user pasted into proxy target. */
export function normalizeProxyOrigin(raw: string): string {
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

export function loadConnectionProfile(): ConnectionProfile {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_CONNECTION_PROFILE };
  }
  const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_CONNECTION_PROFILE };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ConnectionProfile> & { browserBase?: string };
    const legacyPrefix = parsed.browserBase;
    return {
      headers: { ...DEFAULT_CONNECTION_PROFILE.headers, ...parsed.headers },
      pathPrefixOverrides: parsed.pathPrefixOverrides ?? {},
      proxyTarget: parsed.proxyTarget ?? DEFAULT_CONNECTION_PROFILE.proxyTarget,
      sdkPathPrefix: normalizeSdkPathPrefix(parsed.sdkPathPrefix ?? legacyPrefix ?? DEFAULT_CONNECTION_PROFILE.sdkPathPrefix),
    };
  } catch {
    return { ...DEFAULT_CONNECTION_PROFILE };
  }
}

export function saveConnectionProfile(profile: ConnectionProfile): void {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function persistConnectionSettings(
  profile: ConnectionProfile,
  settings: { proxyTarget: string; sdkPathPrefix: string },
): ConnectionProfile {
  const next: ConnectionProfile = {
    ...profile,
    proxyTarget: normalizeProxyOrigin(settings.proxyTarget),
    sdkPathPrefix: normalizeSdkPathPrefix(settings.sdkPathPrefix),
  };
  saveConnectionProfile(next);
  return next;
}

/** @deprecated use persistConnectionSettings */
export function persistProxyTarget(profile: ConnectionProfile, target: string): ConnectionProfile {
  return persistConnectionSettings(profile, { proxyTarget: target, sdkPathPrefix: profile.sdkPathPrefix });
}

export interface PlaygroundSdkConfig {
  baseUrl: string;
  pathPrefix?: string;
  headers: () => Record<string, string> | Promise<Record<string, string>>;
}

export function buildSdkClientConfig(
  profile: ConnectionProfile,
  domain: "agent" | "flow" | "kb" | "llm",
  face: "client" | "console",
): PlaygroundSdkConfig {
  const root = normalizeSdkPathPrefix(profile.sdkPathPrefix);
  const overrideKey = `${domain}-${face}`;
  const pathPrefix = profile.pathPrefixOverrides[overrideKey] ?? DEFAULT_PATH_PREFIX[overrideKey];

  if (domain === "agent" && face === "client") {
    return {
      baseUrl: `${root}${DOMAIN_SUFFIX.agent.client}`,
      headers: () => profile.headers,
    };
  }

  return {
    baseUrl: root,
    headers: () => profile.headers,
    pathPrefix,
  };
}

export async function fetchProxyTarget(): Promise<string> {
  const res = await fetch("/__playground/proxy-target");
  if (!res.ok) {
    throw new Error(`proxy-target GET failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { target: string };
  return body.target;
}

export async function updateProxyTarget(target: string): Promise<string> {
  const res = await fetch("/__playground/proxy-target", {
    body: JSON.stringify({ target: normalizeProxyOrigin(target) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`proxy-target POST failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { target: string };
  return body.target;
}

export async function fetchSdkPathPrefix(): Promise<string> {
  const res = await fetch("/__playground/path-prefix");
  if (!res.ok) {
    throw new Error(`path-prefix GET failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { prefix: string };
  return body.prefix;
}

export async function updateSdkPathPrefix(prefix: string): Promise<string> {
  const res = await fetch("/__playground/path-prefix", {
    body: JSON.stringify({ prefix: normalizeSdkPathPrefix(prefix) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`path-prefix POST failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { prefix: string };
  return body.prefix;
}

export async function applyConnectionSettings(profile: ConnectionProfile): Promise<ConnectionProfile> {
  const [proxyTarget, sdkPathPrefix] = await Promise.all([
    updateProxyTarget(profile.proxyTarget),
    updateSdkPathPrefix(profile.sdkPathPrefix),
  ]);
  return persistConnectionSettings(profile, { proxyTarget, sdkPathPrefix });
}
