import { type InjectionKey, inject, provide } from "vue";

import { AgenticClient, type AgenticClientOptions } from "@cube-ai/agent-sdk-client";

export const AGENTIC_CLIENT_KEY: InjectionKey<AgenticClient> = Symbol.for("@cube-ai/agent-sdk-client-vue.client");

/**
 * Root-level provider: `app.provide(AGENTIC_CLIENT_KEY, new AgenticClient(...))`
 * or used inside setup():
 *   const client = provideAgenticClient({ baseUrl: 'http://localhost:3000' })
 */
export function provideAgenticClient(options: AgenticClientOptions): AgenticClient {
  const client = new AgenticClient(options);
  provide(AGENTIC_CLIENT_KEY, client);
  return client;
}

/**
 * Composable to grab the provided client in any descendant.
 * Throws if no client is registered — surfaces misconfiguration early.
 */
export function useAgenticClient(): AgenticClient {
  const client = inject(AGENTIC_CLIENT_KEY);
  if (!client) {
    throw new Error(
      "[@cube-ai/agent-sdk-client-vue] AgenticClient is not provided. " +
        "Call provideAgenticClient() at the app root or app.provide(AGENTIC_CLIENT_KEY, ...).",
    );
  }
  return client;
}
