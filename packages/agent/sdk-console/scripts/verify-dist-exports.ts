const mod = await import("../dist/index.js");

const requiredExports = [
  "createAgentConsoleClient",
  "agentConsoleStreamSse",
  "agentConsoleRequestText",
  "agentConsoleRequestJson",
  "AgentConsoleClient",
] as const;

for (const name of requiredExports) {
  if (mod[name] === undefined) {
    throw new TypeError(`dist/index.js export ${name} is undefined`);
  }
}

const client = mod.createAgentConsoleClient({
  baseUrl: "http://agent-sdk-console-dist.test",
  fetchImpl: (() => Response.json({ items: [] })) as typeof fetch,
});

if (!(client instanceof mod.AgentConsoleClient)) {
  throw new Error("createAgentConsoleClient did not return AgentConsoleClient");
}
