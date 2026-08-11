import { Application, DATABASE_SERVICE_TOKEN, DatabaseService, Global, Module, ModuleRegistry } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { AGENTIC_PLATFORM_LLM_CATALOG_TOKEN } from "@cube-ai/contracts/platform";
import { DocumentModule, DocumentService, KbMysqlDatabaseService, type KbTransactionRunner } from "@cube-ai/kb-core";

import { AiCenterKbHttpModule } from "./ai-center-kb-http.module";

@Global()
@Module({
  exports: [AGENTIC_PLATFORM_LLM_CATALOG_TOKEN],
  providers: [{ provide: AGENTIC_PLATFORM_LLM_CATALOG_TOKEN, useValue: {} }],
})
class FakeLlmCatalogModule {}

describe("AiCenterKbHttpModule", () => {
  test("resolves DocumentService with the KB transactional database provider", () => {
    const app = new Application({ enableSignalHandlers: false });

    app.registerModule(FakeLlmCatalogModule);
    app.registerModule(AiCenterKbHttpModule);

    const documentModuleRef = ModuleRegistry.getInstance().getModuleRef(DocumentModule);
    expect(documentModuleRef).toBeDefined();
    expect(documentModuleRef?.container.resolve(DocumentService)).toBeInstanceOf(DocumentService);

    const database = documentModuleRef?.container.resolve(DATABASE_SERVICE_TOKEN) as
      | (KbMysqlDatabaseService & KbTransactionRunner)
      | undefined;
    expect(database).toBeInstanceOf(KbMysqlDatabaseService);
    expect(typeof database?.runInTransaction).toBe("function");
    expect(documentModuleRef?.container.resolve(DatabaseService)).toBe(database);
  });
});
