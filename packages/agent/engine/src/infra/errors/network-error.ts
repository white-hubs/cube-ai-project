const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

export interface NetworkErrorDetails {
  code: string;
  address?: string;
  port?: number;
  syscall?: string;
}

export function extractNetworkError(err: unknown): NetworkErrorDetails | null {
  if (!(err instanceof Error)) {
    return null;
  }

  const nodeErr = err as NodeJS.ErrnoException & { address?: string; port?: number };
  if (nodeErr.code && NETWORK_ERROR_CODES.has(nodeErr.code)) {
    return {
      code: nodeErr.code,
      address: nodeErr.address,
      port: nodeErr.port,
      syscall: nodeErr.syscall,
    };
  }

  if (NETWORK_ERROR_CODES.has(err.message)) {
    return { code: err.message, syscall: nodeErr.syscall };
  }

  const match = err.message.match(
    /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|EAI_AGAIN)\b/,
  );
  if (match) {
    const addressMatch = err.message.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/);
    return {
      code: match[1]!,
      address: addressMatch?.[1],
      port: addressMatch?.[2] ? Number(addressMatch[2]) : undefined,
      syscall: nodeErr.syscall,
    };
  }

  return null;
}

export function formatNetworkErrorMessage(
  details: NetworkErrorDetails,
  hint = 'Verify QDRANT_URL, MYSQL_HOST, cube2/Nacos endpoints, and the LLM embedding provider base URL from inside the ai-center container.',
): string {
  const target =
    details.address && details.port !== undefined
      ? `${details.address}:${details.port}`
      : details.address;
  const targetSuffix = target ? ` (${target})` : '';
  return `Upstream connection failed${targetSuffix}: ${details.code}. ${hint}`;
}
