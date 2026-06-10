/**
 * MockOboService — OBO token provider (RS256) for dev/test.
 *
 * Uses Web Crypto RSA keys so `jose` works under Bun (browser-target build).
 *
 * ref: docs/detailed-design/04-auth-and-authz/mock-obo.md §2
 *      P3-02-auth-oauth2 §3.2
 */
import { createHash, randomUUID } from 'node:crypto';
import type { CryptoKey, JWK } from 'jose';
import { exportJWK, SignJWT } from 'jose';
import {
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';
import {
  DualSubjectSchema,
  type DualSubject,
  type ExchangedToken,
  type OboExchangeInput,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';

const DEFAULT_TTL_SECONDS = 600;
const MAX_TTL_SECONDS = 900;

export const MOCK_OBO_ISSUER = 'agentic-engine-mock-obo';
export const MOCK_OBO_KID = 'agentic-engine-mock-obo-v1';

export interface MockOboServiceOptions {
  resolvePrivateKeyPem?: () => string | undefined;
}

type MaterializedKeys = {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
};

let sharedInstance: MockOboService | undefined;

export function getSharedMockOboService(): MockOboService {
  if (!sharedInstance) sharedInstance = new MockOboService();
  return sharedInstance;
}

/**
 * 从 `Authorization: Bearer <jwt>` 解析 payload.sub（**不验签**）。
 * 失败（无 header / 非 Bearer / 非三段式 / payload 不是 JSON / 无 sub）时返回 null。
 *
 * 仅用于 mock 模式取 userId — 与生产 oauth2 introspection 的 sub 同义。
 */
function readJwtSubFromAuthorization(rawAuth: string | undefined): string | null {
  if (!rawAuth) return null;
  const auth = rawAuth.trim();
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice('bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payloadSeg = parts[1] ?? '';
  if (!payloadSeg) return null;
  try {
    const normalized = payloadSeg.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    const sub = payload['sub'];
    if (typeof sub === 'string' && sub.length > 0) return sub;
    if (typeof sub === 'number' && Number.isFinite(sub)) return String(sub);
    return null;
  } catch {
    return null;
  }
}

export class MockOboService {
  private materialPromise: Promise<MaterializedKeys> | null = null;
  private jwksBody: { keys: JWK[] } | null = null;

  constructor(private readonly opts: MockOboServiceOptions = {}) {}

  fakeSubject(ctx: { headers?: Record<string, string | undefined> }): DualSubject {
    const headers = ctx.headers ?? {};
    const lower = (k: string) => headers[k.toLowerCase()];
    /**
     * 取值规则向 oauth2 模式收敛（差异仅在 mock 不验签）：
     *  - tenant：前端 CubeGateway 注入的标准 `tenant` header 优先；
     *            `x-mock-tenant` 仅作离线测试 / curl 兜底；最终回退到 `1`。
     *  - userId：解析 `Authorization: Bearer <jwt>` payload 的 `sub` 字段（不验签）；
     *            `x-mock-user` 兜底；最终回退到 `'mock-user'`。
     *
     * 这与生产 oauth2 introspection 的输出形态一致，使前端无需为 dev 联调发任何
     * 自定义 header — 主框架自动注入的 `tenant` + `Authorization` 即可走通。
     */
    const tenantRaw =
      lower('tenant') ??
      lower('x-mock-tenant') ??
      lower('x-mock-tenant-id') ??
      '1';
    const tenant = parseInt(tenantRaw, 10) || 1;
    const tokenSub = readJwtSubFromAuthorization(lower('authorization'));
    const userId =
      tokenSub ??
      lower('x-mock-user') ??
      lower('x-mock-user-id') ??
      'mock-user';
    const traceId = lower('x-trace-id') ?? `mock-trace-${Date.now()}`;
    const scopes = ['engine.use', 'openid'];
    const rawTokenSha256 = createHash('sha256').update(`${userId}:${tenant}:${traceId}`).digest('hex');

    return DualSubjectSchema.parse({
      user: {
        userId,
        tenant,
        displayName: `Mock User (${userId})`,
        scopes,
        rawTokenSha256,
        expiresAt: Date.now() + 3600_000,
      },
      service: {
        clientId: 'mock-obo-client',
        scopes: ['engine.use'],
        expiresAt: Date.now() + 3600_000,
      },
      tenant,
      traceId,
      terminal: 'web',
    });
  }

  private async loadMaterial(): Promise<MaterializedKeys> {
    const pem =
      process.env['AGENTIC_ENGINE_MOCK_OBO_PRIVATE_KEY_PEM']?.replace(/\\n/g, '\n') ??
      this.opts.resolvePrivateKeyPem?.()?.replace(/\\n/g, '\n');

    if (pem) {
      const privNode = createPrivateKey({ key: pem, format: 'pem' });
      const pubNode = createPublicKey(privNode);
      const privDer = new Uint8Array(privNode.export({ type: 'pkcs8', format: 'der' }) as Uint8Array);
      const pubDer = new Uint8Array(pubNode.export({ type: 'spki', format: 'der' }) as Uint8Array);

      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        privDer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );

      const pubCrypto = await crypto.subtle.importKey(
        'spki',
        pubDer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        true,
        ['verify'],
      );
      const jwk = await exportJWK(pubCrypto);
      const publicJwk: JWK = {
        ...jwk,
        kid: MOCK_OBO_KID,
        use: 'sig',
        alg: 'RS256',
      };

      return { kid: MOCK_OBO_KID, privateKey, publicJwk };
    }

    const allowDevKeys =
      process.env['NODE_ENV'] !== 'production' ||
      process.env['AGENTIC_ENGINE_MOCK_OBO_DEV_AUTOKEY'] === 'true';
    if (!allowDevKeys) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_SECRET_MISSING',
        'Mock OBO private key missing: set AGENTIC_ENGINE_MOCK_OBO_PRIVATE_KEY_PEM or enable AGENTIC_ENGINE_MOCK_OBO_DEV_AUTOKEY in production',
      );
    }

    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );

    const privateKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    const publicJwk: JWK = {
      ...jwk,
      kid: MOCK_OBO_KID,
      use: 'sig',
      alg: 'RS256',
    };

    return { kid: MOCK_OBO_KID, privateKey, publicJwk };
  }

  private ensureMaterial(): Promise<MaterializedKeys> {
    if (!this.materialPromise) this.materialPromise = this.loadMaterial();
    return this.materialPromise;
  }

  async getJwksBody(): Promise<{ keys: JWK[] }> {
    if (this.jwksBody) return this.jwksBody;
    const m = await this.ensureMaterial();
    this.jwksBody = { keys: [m.publicJwk] };
    return this.jwksBody;
  }

  async exchange(input: OboExchangeInput): Promise<ExchangedToken> {
    const ttl = Math.min(input.ttlHintSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS);
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + ttl;
    const { privateKey, kid } = await this.ensureMaterial();

    const jti = `obo_${randomUUID().replace(/-/g, '')}`;
    const userPrefix = createHash('sha256').update(`${input.subjectUserId}`).digest('hex').slice(0, 8);

    const jwt = await new SignJWT({
      tenant_id: String(input.tenant),
      scope: input.targetScope.join(' '),
      act: { sub: 'cube-agentic-engine' },
      _mock: true,
      _origin_user_token_sha256_prefix: userPrefix,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
      .setIssuer(MOCK_OBO_ISSUER)
      .setSubject(input.subjectUserId)
      .setAudience(input.audience ?? 'agentic-engine')
      .setIssuedAt(nowSec)
      .setNotBefore(nowSec)
      .setExpirationTime(exp)
      .setJti(jti)
      .sign(privateKey);

    return {
      token: jwt,
      issuer: MOCK_OBO_ISSUER,
      audience: input.audience,
      scope: [...input.targetScope],
      expiresAt: exp * 1000,
      source: 'mock',
      kid,
      cached: false,
    };
  }

  jwksPath(): string {
    return '/.well-known/agentic-engine-mock-obo/jwks.json';
  }
}
