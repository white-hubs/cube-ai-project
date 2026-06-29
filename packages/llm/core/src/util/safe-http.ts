import { BadRequestException, HttpException } from "@dangao/bun-server";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

function validateExternalHttpUrl(input: string | URL): URL {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestException("上游地址仅支持 http/https");
  }
  return url;
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpException(response.status, `调用上游失败: ${response.status} 响应过大`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function safeFetchJson<T>(
  input: string | URL,
  init?: RequestInit,
  options?: { timeoutMs?: number; maxResponseBytes?: number },
): Promise<T> {
  const url = validateExternalHttpUrl(input);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await readTextLimited(response, maxResponseBytes);
    if (!response.ok) {
      throw new HttpException(response.status, `调用上游失败: ${response.status} ${text}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    if (error instanceof HttpException) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new HttpException(504, "调用上游超时");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
