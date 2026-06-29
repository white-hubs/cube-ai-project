import { type RsaJsonWebKey, type VerificationKey, importRsaVerificationKey } from "./jwt-crypto";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface JwksResponse {
  keys?: RsaJsonWebKey[];
}

function parseXmlKey(text: string): RsaJsonWebKey | null {
  const eMatch = text.match(/<e>([^<]+)<\/e>/u);
  const nMatch = text.match(/<n>([^<]+)<\/n>/u);
  if (!eMatch || !nMatch) {
    return null;
  }
  return {
    e: eMatch[1] ?? "",
    kty: "RSA",
    n: nMatch[1] ?? "",
  };
}

function parseJsonKeys(text: string): RsaJsonWebKey[] {
  const data = JSON.parse(text) as JwksResponse;
  return Array.isArray(data.keys) ? data.keys : [];
}

export function createJwtKeyLoader(jwtKeyUrl: string): {
  getVerificationKey: () => Promise<VerificationKey | null>;
  refresh: () => Promise<void>;
} {
  let cached: { key: VerificationKey; expiresAt: number } | null = null;

  async function fetchAndParse(): Promise<VerificationKey | null> {
    const response = await fetch(jwtKeyUrl, {
      headers: { Accept: "application/json, application/xml, text/xml, */*" },
    });
    if (!response.ok) {
      return null;
    }
    const text = (await response.text()).trim();
    const jwk = text.startsWith("{") ? (parseJsonKeys(text)[0] ?? null) : parseXmlKey(text);
    return jwk ? importRsaVerificationKey(jwk) : null;
  }

  async function refresh(): Promise<void> {
    const key = await fetchAndParse();
    cached = key ? { expiresAt: Date.now() + CACHE_TTL_MS, key } : null;
  }

  async function getVerificationKey(): Promise<VerificationKey | null> {
    if (cached && Date.now() < cached.expiresAt) {
      return cached.key;
    }
    await refresh();
    return cached?.key ?? null;
  }

  return { getVerificationKey, refresh };
}

/** Test/dev helper: pin a static verification key without HTTP fetch. */
export function createStaticJwtKeyLoader(key: VerificationKey): {
  getVerificationKey: () => Promise<VerificationKey | null>;
  refresh: () => Promise<void>;
} {
  return {
    getVerificationKey: async () => key,
    refresh: async () => {},
  };
}
