import { Module } from "@dangao/bun-server";

import { DocumentModule } from "./documents/document.module";

@Module({
  imports: [DocumentModule],
})
export class AiKbModule {}
