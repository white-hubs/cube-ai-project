import { Injectable } from '@dangao/bun-server';
import { NacosClient, NacosConfigClient } from '@dangao/nacos-client';

import { AgenticEngineError } from '../errors/agentic-error';

/**
 * In-process secrets registry (process-memory only; never serialised).
 * ref: secrets-management.md §4.2 SecretsRegistry interface
 *
 * Production: secrets come from KMS-decrypted Nacos values;解析后仍须避免入日志。
 */
export interface SecretsRegistry {
  /** Returns the decrypted secret value by its ref alias. */
  get(refAlias: string): string;
  /** Lists all loaded alias names (for /health/security). */
  listAliases(): string[];
  /** Returns the public key PEM for a given kid (Mock OBO JWKS). */
  getPublicKey(kid: string): string | null;
  /** Currently accepted kids for dual-kid rotation window. */
  verifyAcceptedKids(): string[];
}

export interface NacosSecretsConfig {
  /** NACOS_ADDRESS env; e.g. `http://nacos:8848` */
  nacosAddress: string;
  /** NACOS_NAMESPACE */
  nacosNamespace: string;
  /** NACOS_USERNAME */
  nacosUsername: string;
  /** NACOS_PASSWORD */
  nacosPassword: string;
  /** group for secret dataIds; default `agentic-engine-secrets` */
  secretsGroup?: string;
}

/**
 * NacosSecretsLoader — loads secrets bundle from Nacos at startup (fail-fast)。
 *
 * - `AGENTIC_ENGINE_SECRETS_SOURCE=env`：仅从 `AGENTIC_SECRET_<KEY>` / 进程环境键加载（本地开发）
 * - 否则：HTTP 拉取 DataId（JSON 对象，键为大写别名）
 */
@Injectable()
export class NacosSecretsLoader {
  /** In-memory secret store */
  public readonly secrets: Record<string, string> = {};

  private readonly publicKeys: Record<string, string> = {};
  private acceptedKids: string[] = [];

  /** 首次 `load()` 时创建的客户端；不在 provider 工厂里发起网络请求（R24） */
  private httpClient: NacosClient | null = null;

  constructor(private readonly config: NacosSecretsConfig) {}

  /**
   * 启动时加载；失败则 throw（由 bootstrap 捕获并退出进程）。
   */
  async load(): Promise<SecretsRegistry> {
    const source = process.env.AGENTIC_ENGINE_SECRETS_SOURCE;
    if (source === 'env' || !this.config.nacosAddress?.trim()) {
      this.loadFromEnvPrefix();
      return this;
    }

    const client = this.getOrCreateClient();
    const cfg = new NacosConfigClient(client);
    const group = this.config.secretsGroup ?? 'agentic-engine-secrets';
    const dataId =
      process.env.AGENTIC_ENGINE_SECRETS_BUNDLE_DATA_ID ??
      'agentic-engine-secrets';

    const result = await cfg.getConfig({
      dataId,
      groupName: group,
      namespaceId: this.config.nacosNamespace || undefined,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.content) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `NacosSecretsLoader: secrets bundle JSON parse failed for ${dataId}: ${e}`,
      );
    }

    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') {
        throw new Error(
          `NacosSecretsLoader: secret '${k}' must be a string in bundle JSON`,
        );
      }
      this.secrets[k] = v;
    }

    return this;
  }

  private getOrCreateClient(): NacosClient {
    if (!this.httpClient) {
      this.httpClient = new NacosClient({
        serverList: [this.config.nacosAddress.trim()],
        namespaceId: this.config.nacosNamespace || undefined,
        username: this.config.nacosUsername || undefined,
        password: this.config.nacosPassword || undefined,
      });
    }
    return this.httpClient;
  }

  /**
   * `AGENTIC_SECRET_<ALIAS>` 优先于 `process.env[ALIAS]`，填充 `secrets` 映射。
   */
  private loadFromEnvPrefix(): void {
    const prefix = 'AGENTIC_SECRET_';
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith(prefix) || v === undefined) continue;
      const alias = k.slice(prefix.length);
      if (alias) this.secrets[alias] = v;
    }
  }

  /**
   * 环境变量优先 → 已加载 Nacos bundle。
   */
  get(refAlias: string): string {
    const fromEnv =
      process.env[`AGENTIC_SECRET_${refAlias}`] ?? process.env[refAlias];
    if (fromEnv !== undefined && fromEnv !== '') {
      return fromEnv;
    }

    const v = this.secrets[refAlias];
    if (v === undefined) {
      throw AgenticEngineError.fromCode(
        'UNAVAILABLE_SECRET_NOT_FOUND',
        `Secret '${refAlias}' not available`,
        { refAlias },
      );
    }
    return v;
  }

  listAliases(): string[] {
    return Object.keys(this.secrets);
  }

  getPublicKey(kid: string): string | null {
    return this.publicKeys[kid] ?? null;
  }

  verifyAcceptedKids(): string[] {
    return [...this.acceptedKids];
  }

  /** 单测注入 */
  seedForTest(secrets: Record<string, string>): void {
    Object.assign(this.secrets, secrets);
  }
}
