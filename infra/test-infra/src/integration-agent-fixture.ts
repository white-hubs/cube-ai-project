import { join } from "node:path";

/** Agent id used across engine/sdk integration testcontainers suites. */
export const INTEGRATION_AGENT_ID = "1234567890123456789";

/** Static on-disk agent descriptor dir for {@link startEngineIntegrationProcess}. */
export const INTEGRATION_AGENT_DESCRIPTOR_DIR = join(import.meta.dir, "..", "fixtures", "integration-agent");
