import {
  AgentConsoleClient as BaseAgentConsoleClient,
} from './client';
import {
  agentConsoleRequestJson as agentConsoleRequestJsonValue,
  agentConsoleRequestText as agentConsoleRequestTextValue,
  agentConsoleStreamSse as agentConsoleStreamSseValue,
  type AgentConsoleConfig,
} from './http';

export type {
  AgentContentInput,
  FromDocumentResult,
  LibraryBrowseOptions,
  ProposeOptions,
  RuleContentInput,
  ShelfListOptions,
  SkillContentInput,
} from './client';
export type { ProposeRequest, ProposeResult, ProposeSuggestion } from '@cube-ai/contracts';

const agentConsoleRequestJson = agentConsoleRequestJsonValue;
const agentConsoleRequestText = agentConsoleRequestTextValue;
const agentConsoleStreamSse = agentConsoleStreamSseValue;

export class AgentConsoleClient extends BaseAgentConsoleClient {}

export function createAgentConsoleClient(config: AgentConsoleConfig): AgentConsoleClient {
  return new AgentConsoleClient(config);
}

export {
  agentConsoleRequestJson,
  agentConsoleRequestText,
  agentConsoleStreamSse,
};
export type { AgentConsoleConfig, AgentConsoleSseEvent } from './http';
