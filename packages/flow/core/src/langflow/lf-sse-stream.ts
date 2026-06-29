import { encodeCubeSseEvent, isLangflowAssistantAddMessage, mapLangflowBuildEnvelope } from "./build-event-mapper";

interface ParsedLfMessage {
  dataJson: string;
  sseEvent?: string;
}

export interface TransformLangflowSseOptions {
  /** 并入每条 Cube SSE payload.ext */
  mergeRequestExt?: Record<string, unknown>;
}

function parseSseBlock(block: string): ParsedLfMessage | null {
  const lines = block.split(/\r?\n/u);
  const dataParts: string[] = [];
  let sseEvent: string | undefined;
  for (const line of lines) {
    if (line.startsWith("event:")) {
      sseEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trimStart());
    }
  }
  if (dataParts.length === 0) {
    const ev = sseEvent?.trim();
    if (ev === "end" || ev === "error") {
      return { dataJson: "{}", sseEvent };
    }
    return null;
  }
  return { dataJson: dataParts.join("\n"), sseEvent };
}

function envelopeForMapper(dataObj: unknown, sseEvent?: string): unknown {
  const o = dataObj && typeof dataObj === "object" && !Array.isArray(dataObj) ? (dataObj as Record<string, unknown>) : null;
  if (o && typeof o["event"] === "string" && o["event"].length > 0) {
    return dataObj;
  }
  const ev = sseEvent?.trim();
  if (ev && ev !== "message") {
    return { data: dataObj, event: ev };
  }
  if (o && typeof o["chunk"] === "string" && o["chunk"] !== "") {
    return { data: dataObj, event: "token" };
  }
  return dataObj;
}

interface LfStreamState {
  sawLfEnd: boolean;
  sawStreamContent: boolean;
  sawToken: boolean;
}

function emitLangflowEnvelope(
  envelope: unknown,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: LfStreamState,
  mergeRequestExt?: Record<string, unknown>,
) {
  const pre = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? (envelope as Record<string, unknown>) : null;
  const lfEv = typeof pre?.["event"] === "string" ? pre["event"] : "";

  const cubes = mapLangflowBuildEnvelope(envelope);
  for (let cube of cubes) {
    if (cube.type === "end" && lfEv === "end_vertex" && !state.sawToken) {
      cube = {
        payload: { detail: pre?.["data"], phase: "vertex_done" },
        type: "message_delta",
      };
    }
    const assistantAddMessageAfterTokens =
      cube.type === "message" && lfEv === "add_message" && isLangflowAssistantAddMessage(pre?.["data"]) && state.sawToken;

    if (cube.type === "token") {
      state.sawToken = true;
    }
    if (cube.type === "token" || cube.type === "message") {
      state.sawStreamContent = true;
    }
    if (cube.type === "end") {
      state.sawLfEnd = true;
    }
    controller.enqueue(encodeCubeSseEvent(cube, mergeRequestExt));
    if (assistantAddMessageAfterTokens && !state.sawLfEnd) {
      state.sawLfEnd = true;
      controller.enqueue(encodeCubeSseEvent({ payload: {}, type: "end" }, mergeRequestExt));
    }
  }
}

function emitBlock(
  block: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: LfStreamState,
  mergeRequestExt?: Record<string, unknown>,
) {
  const nl0 = block.indexOf("\n");
  const headEnvelope = nl0 > 0 ? parseJsonEventEnvelope(block.slice(0, nl0).trim()) : null;
  if (headEnvelope) {
    emitLangflowEnvelope(headEnvelope, controller, state, mergeRequestExt);
    if (state.sawLfEnd) {
      return;
    }
    const rest = block.slice(nl0 + 1);
    if (rest.trim()) {
      emitBlock(rest, controller, state, mergeRequestExt);
    }
    return;
  }
  const parsed = parseSseBlock(block);
  if (!parsed) {
    return;
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(parsed.dataJson) as unknown;
  } catch {
    return;
  }
  envelope = envelopeForMapper(envelope, parsed.sseEvent);
  emitLangflowEnvelope(envelope, controller, state, mergeRequestExt);
}

function parseJsonEventEnvelope(text: string): { event?: string } | null {
  if (!text.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as { event?: string };
    return typeof parsed?.event === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function emitTailBuffer(
  buffer: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: LfStreamState,
  mergeRequestExt?: Record<string, unknown>,
): void {
  if (!buffer.trim()) {
    return;
  }
  const envelope = parseJsonEventEnvelope(buffer.trim());
  if (envelope) {
    emitLangflowEnvelope(envelope, controller, state, mergeRequestExt);
    return;
  }
  emitBlock(buffer, controller, state, mergeRequestExt);
}

function blockLooksLikeSse(block: string): boolean {
  for (const line of block.split(/\r?\n/u)) {
    const t = line.trimStart();
    if (t.startsWith("event:") || t.startsWith("data:")) {
      return true;
    }
  }
  return false;
}

type LfDrainAction = { kind: "sse"; block: string } | { kind: "env"; envelope: unknown } | { kind: "skip" };

function nextLfPayload(buffer: string): { rest: string; action: LfDrainAction } | null {
  const iLf = buffer.indexOf("\n\n");
  const iCrLf = buffer.indexOf("\r\n\r\n");
  const hasSseDelim = iLf !== -1 || iCrLf !== -1;
  if (hasSseDelim) {
    const useCrLf = iCrLf !== -1 && (iLf === -1 || iCrLf < iLf);
    const delimStart = useCrLf ? iCrLf : iLf;
    const delimLen = useCrLf ? 4 : 2;
    const block = buffer.slice(0, delimStart);
    const after = buffer.slice(delimStart + delimLen);
    if (blockLooksLikeSse(block)) {
      return { action: { block, kind: "sse" }, rest: after };
    }
    const firstLine = block.split(/\r?\n/u)[0]?.trim() ?? "";
    if (firstLine.startsWith("{")) {
      try {
        const o = JSON.parse(firstLine) as { event?: string };
        if (typeof o?.event === "string") {
          return { action: { envelope: o, kind: "env" }, rest: after };
        }
      } catch {
        /* fall through */
      }
    }
    return { action: { kind: "skip" }, rest: after };
  }

  const nl = buffer.indexOf("\n");
  if (nl === -1) {
    return null;
  }
  const line = buffer.slice(0, nl).replace(/\r$/u, "").trim();
  const afterNl = buffer.slice(nl + 1);
  if (!line.startsWith("{")) {
    return null;
  }
  try {
    const o = JSON.parse(line) as { event?: string };
    if (typeof o?.event === "string") {
      return { action: { envelope: o, kind: "env" }, rest: afterNl };
    }
  } catch {
    return null;
  }
  return null;
}

function drainLfBuffer(
  bufferRef: { buf: string },
  controller: ReadableStreamDefaultController<Uint8Array>,
  lfState: LfStreamState,
  mergeRequestExt?: Record<string, unknown>,
) {
  for (;;) {
    const next = nextLfPayload(bufferRef.buf);
    if (!next) {
      break;
    }
    bufferRef.buf = next.rest;
    const a = next.action;
    if (a.kind === "skip") {
      continue;
    }
    if (a.kind === "sse") {
      emitBlock(a.block, controller, lfState, mergeRequestExt);
    } else {
      emitLangflowEnvelope(a.envelope, controller, lfState, mergeRequestExt);
    }
    if (lfState.sawLfEnd) {
      break;
    }
  }
}

export function transformLangflowSseToCube(
  lfBody: ReadableStream<Uint8Array>,
  options?: TransformLangflowSseOptions,
): ReadableStream<Uint8Array> {
  const mergeRequestExt = options?.mergeRequestExt;
  const upstream = lfBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lfState = { sawLfEnd: false, sawStreamContent: false, sawToken: false };

  return new ReadableStream({
    cancel() {
      void upstream.cancel();
    },
    async start(controller) {
      const drain = () => {
        const ref = { buf: buffer };
        drainLfBuffer(ref, controller, lfState, mergeRequestExt);
        buffer = ref.buf;
      };

      try {
        for (;;) {
          drain();
          if (lfState.sawLfEnd) {
            void upstream.cancel();
            break;
          }

          const { done, value } = await upstream.read();
          if (done) {
            drain();
            emitTailBuffer(buffer, controller, lfState, mergeRequestExt);
            if (!lfState.sawLfEnd) {
              controller.enqueue(encodeCubeSseEvent({ type: "end", payload: {} }, mergeRequestExt));
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          drain();
          if (lfState.sawLfEnd) {
            void upstream.cancel();
            break;
          }
        }
      } catch {
        if (!lfState.sawLfEnd) {
          try {
            controller.enqueue(encodeCubeSseEvent({ type: "end", payload: {} }, mergeRequestExt));
          } catch {
            /* ignore */
          }
        }
      } finally {
        await Promise.resolve();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
        upstream.cancel().catch(() => {});
      }
    },
  });
}
