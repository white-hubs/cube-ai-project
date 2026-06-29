import { Module } from "@dangao/bun-server";

import { NacosSecretsLoader } from "./nacos-secrets.loader";
import { SecretResolver } from "./secret-resolver";

/**
 * SecretsModule — DI registration for Nacos secrets infrastructure.
 * ref: P1-12 design doc §6.1
 *
 * Must be registered EARLY in engine-assembler (before InfraModule)
 * so that config-dependent modules can inject SecretResolver。
 *
 * 配置：`AGENTIC_ENGINE_NACOS_*`（见下方 useFactory）。
 */
@Module({
  providers: [
    {
      provide: NacosSecretsLoader,
      useFactory: () => {
        return new NacosSecretsLoader({
          nacosAddress: process.env["AGENTIC_ENGINE_NACOS_URL"] ?? "",
          nacosNamespace: process.env["AGENTIC_ENGINE_NACOS_NAMESPACE"] ?? "",
          nacosUsername: process.env["AGENTIC_ENGINE_NACOS_USERNAME"] ?? "",
          nacosPassword: process.env["AGENTIC_ENGINE_NACOS_PASSWORD"] ?? "",
          secretsGroup: process.env["AGENTIC_ENGINE_NACOS_SECRETS_GROUP"] ?? "agentic-engine-secrets",
        });
      },
    },
    SecretResolver,
  ],
  exports: [NacosSecretsLoader, SecretResolver],
})
export class SecretsModule {}
