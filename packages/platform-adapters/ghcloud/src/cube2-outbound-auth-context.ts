import { AsyncLocalStorage } from "node:async_hooks";

import { sessionContextHolder } from "./session-context";

export interface Cube2OutboundAuthContext {
  tenant?: string | null;
  authorization?: string | null;
  terminal?: string | null;
}

export const cube2OutboundAuthAls = new AsyncLocalStorage<Cube2OutboundAuthContext>();

export function readCube2OutboundAuthContext(): Cube2OutboundAuthContext {
  const fromAls = cube2OutboundAuthAls.getStore();
  const session = sessionContextHolder.getContext();
  const tenantFromSession = session?.tenant !== undefined && session?.tenant !== null ? String(session.tenant) : null;

  return {
    authorization: fromAls?.authorization ?? session?.authorization ?? null,
    tenant: fromAls?.tenant ?? tenantFromSession,
    terminal: fromAls?.terminal ?? session?.terminal ?? null,
  };
}
