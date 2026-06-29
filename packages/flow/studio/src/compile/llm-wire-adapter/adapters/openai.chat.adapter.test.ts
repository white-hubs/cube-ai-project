import { describe, expect, test } from "bun:test";

import { type WireContext } from "../wire-context.types";
import { joinUrl, openAiChatAdapter } from "./openai.chat.adapter";

function chatContext(partial: Partial<WireContext> = {}): WireContext {
  return {
    adapterKey: "openai.chat",
    apiBaseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    channelProfile: "direct",
    endpointType: "openai",
    modelCode: "gpt-4o",
    nativeFamily: "gpt",
    providerCode: "openai",
    providerTypeCode: "openai",
    requestSchema: { requestShape: "openai_chat_compatible" },
    responseSchema: { responseShape: "openai_chat_completion" },
    ...partial,
  };
}

describe("joinUrl", () => {
  test("joins base and path with single slash", () => {
    expect(joinUrl("https://api.example.com/v1", "/chat/completions")).toBe("https://api.example.com/v1/chat/completions");
    expect(joinUrl("https://api.example.com/v1/", "chat/completions")).toBe("https://api.example.com/v1/chat/completions");
  });

  test("strips trailing slashes and avoids duplicate suffix", () => {
    expect(joinUrl("https://api.example.com/v1///", "/chat/completions")).toBe("https://api.example.com/v1/chat/completions");
    expect(joinUrl("https://api.example.com/v1/chat/completions", "/chat/completions")).toBe("https://api.example.com/v1/chat/completions");
  });
});

describe("openAiChatAdapter.encodeRequest", () => {
  test("builds POST request with bearer auth and default endpoint path", () => {
    const encoded = openAiChatAdapter.encodeRequest(
      {
        messages: [{ role: "user", content: "hi" }],
        model: "gpt-4o",
        parameters: { max_tokens: 128, temperature: 0.7 },
        shape: "chat",
      },
      chatContext(),
    );

    expect(encoded.url).toBe("https://api.example.com/v1/chat/completions");
    expect(encoded.method).toBe("POST");
    expect(encoded.headers).toEqual({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect(encoded.body).toEqual({
      max_tokens: 128,
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
      temperature: 0.7,
    });
  });

  test("honors schema endpointPath and method overrides", () => {
    const encoded = openAiChatAdapter.encodeRequest(
      {
        messages: [],
        model: "gpt-4o",
        parameters: {},
        shape: "chat",
      },
      chatContext({
        requestSchema: { endpointPath: "/custom/chat", method: "GET", requestShape: "openai_chat_compatible" },
      }),
    );

    expect(encoded.url).toBe("https://api.example.com/v1/custom/chat");
    expect(encoded.method).toBe("GET");
  });

  test("strips enableThinking parameters from body unless schema declares a wire field", () => {
    const encoded = openAiChatAdapter.encodeRequest(
      {
        messages: [],
        model: "gpt-4o",
        parameters: { enableThinking: true, enable_thinking: true, temperature: 0.1 },
        shape: "chat",
      },
      chatContext(),
    );

    expect(encoded.body).toEqual({ messages: [], model: "gpt-4o", temperature: 0.1 });
  });

  test("empty apiKey produces empty Authorization header", () => {
    const encoded = openAiChatAdapter.encodeRequest(
      {
        messages: [],
        model: "gpt-4o",
        parameters: {},
        shape: "chat",
      },
      chatContext({ apiKey: "" }),
    );

    expect(encoded.headers.Authorization).toBe("");
  });

  test("rejects image-shaped input", () => {
    expect(() =>
      openAiChatAdapter.encodeRequest(
        {
          model: "gpt-image-1",
          prompt: "cat",
          shape: "image",
        },
        chatContext(),
      ),
    ).toThrow("openai.chat only supports chat requests");
  });
});

describe("openAiChatAdapter.decodeResponse", () => {
  const ctx = chatContext();

  test("extracts first choice message content", () => {
    expect(
      openAiChatAdapter.decodeResponse(
        {
          choices: [{ message: { content: "hello", role: "assistant" } }],
        },
        ctx,
      ),
    ).toEqual({ text: "hello" });
  });

  test("returns empty text for malformed payloads", () => {
    expect(openAiChatAdapter.decodeResponse(null, ctx)).toEqual({ text: "" });
    expect(openAiChatAdapter.decodeResponse("oops", ctx)).toEqual({ text: "" });
    expect(openAiChatAdapter.decodeResponse({ choices: [] }, ctx)).toEqual({ text: "" });
    expect(openAiChatAdapter.decodeResponse({ choices: [{ message: { content: 42 } }] }, ctx)).toEqual({ text: "" });
    expect(openAiChatAdapter.decodeResponse({ choices: [{}] }, ctx)).toEqual({ text: "" });
  });
});
