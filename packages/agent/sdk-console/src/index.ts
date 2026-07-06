import { AgentConsoleClient as BaseAgentConsoleClient } from "./client";
import {
  type AgentConsoleConfig,
  agentConsoleRequestJson as agentConsoleRequestJsonValue,
  agentConsoleRequestText as agentConsoleRequestTextValue,
  agentConsoleStreamSse as agentConsoleStreamSseValue,
} from "./http";

export type { ProposeRequest, ProposeResult, ProposeSuggestion } from "@cube-ai/contracts";
export type {
  AgentContentInput,
  DescriptorCreateRequest,
  FromDocumentResult,
  LibraryBrowseOptions,
  ProposeOptions,
  RuleContentInput,
  ShelfListOptions,
  SkillContentInput,
} from "./client";

const agentConsoleRequestJson = agentConsoleRequestJsonValue;
const agentConsoleRequestText = agentConsoleRequestTextValue;
const agentConsoleStreamSse = agentConsoleStreamSseValue;

export class AgentConsoleClient extends BaseAgentConsoleClient {}

export function createAgentConsoleClient(config: AgentConsoleConfig): AgentConsoleClient {
  return new AgentConsoleClient(config);
}

export type { AgentConsoleConfig, AgentConsoleSseEvent } from "./http";
export { agentConsoleRequestJson, agentConsoleRequestText, agentConsoleStreamSse };
