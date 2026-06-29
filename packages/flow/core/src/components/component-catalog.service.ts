import { HttpException, Inject, Injectable } from "@dangao/bun-server";
import { existsSync, readFileSync } from "node:fs";

import { APP_CONFIG_TOKEN, type AppConfig } from "@cube-ai/ai-center/platform/server-base";

export interface CatalogEntry {
  cubeType: string;
  lfComponentKey: string;
  category: string;
  displayName: string;
  outputNames: string[];
}

interface CatalogFile {
  version: number;
  components: CatalogEntry[];
}

@Injectable()
export class ComponentCatalogService {
  private readonly path: string;

  constructor(@Inject(APP_CONFIG_TOKEN) config: AppConfig) {
    this.path = config.paths.componentCatalogPath;
  }

  getCatalog(): CatalogFile {
    if (!existsSync(this.path)) {
      throw new HttpException(503, "Component catalog not generated. Run: bun run sync-components", {
        code: "CATALOG_MISSING",
      });
    }
    try {
      const raw = readFileSync(this.path, "utf8");
      return JSON.parse(raw) as CatalogFile;
    } catch (e) {
      throw new HttpException(500, `Invalid catalog file: ${e instanceof Error ? e.message : String(e)}`, {
        code: "CATALOG_INVALID",
      });
    }
  }
}
