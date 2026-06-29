export type DeveloperApiAccessLevel = "tenant" | "system";
export type Awaitable<T> = T | Promise<T>;

export interface AccessTokenRecord {
  userId: string;
  username: string;
  role: string;
  isSuperAdmin: boolean;
}

export interface AccessTokenReader {
  verifyAccessToken(rawToken: string): Awaitable<AccessTokenRecord | null>;
}

export interface DeveloperApiKeyRecord {
  id: string;
  flow_id: string | null;
  scopes_json: string | null;
  project_id: string | null;
  access_level: DeveloperApiAccessLevel;
}

export interface DeveloperApiKeyReader {
  verifyApiKeyRaw(rawSecret: string): Awaitable<DeveloperApiKeyRecord | null>;
}
