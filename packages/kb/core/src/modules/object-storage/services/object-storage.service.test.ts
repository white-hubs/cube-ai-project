import { describe, expect, test } from "bun:test";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { ObjectStorageService } from "./object-storage.service";

describe("ObjectStorageService", () => {
  test("constructs with injected AppConfig", () => {
    expect(new ObjectStorageService(makeMockAppConfig())).toBeInstanceOf(ObjectStorageService);
  });
});
