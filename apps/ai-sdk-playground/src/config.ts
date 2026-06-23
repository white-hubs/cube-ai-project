import { DEFAULT_CONNECTION_PROFILE, loadConnectionProfile } from './playground/connection-profile';

/** @deprecated Use loadConnectionProfile() — kept for core-flow smoke tests. */
export function sdkConfig() {
  const profile = loadConnectionProfile();
  return {
    baseUrl: profile.sdkPathPrefix,
    headers: () => profile.headers,
  };
}

export function devAuthHeaders(): Record<string, string> {
  return { ...DEFAULT_CONNECTION_PROFILE.headers };
}
