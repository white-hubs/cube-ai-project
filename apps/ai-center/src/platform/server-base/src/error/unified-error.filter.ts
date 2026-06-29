import { type Context, type ExceptionFilter, HttpException } from "@dangao/bun-server";

function nowTimestamp(): number {
  return Date.now();
}

export interface UnifiedErrorBody {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
  timestamp: number;
}

export class UnifiedErrorFilter implements ExceptionFilter {
  public catch(error: unknown, context: Context): Response | undefined {
    if (error instanceof Response) {
      return error as Response;
    }

    if (error instanceof HttpException) {
      const body: UnifiedErrorBody = {
        code: error.code,
        details: error.details,
        message: error.message,
        status: error.status,
        timestamp: nowTimestamp(),
      };
      context.setStatus(error.status);
      const d = error.details as Record<string, unknown> | undefined;
      const ra = d && typeof d["retryAfterSec"] === "number" && d["retryAfterSec"] > 0 ? d["retryAfterSec"] : undefined;
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      if (ra !== undefined) {
        headers.set("Retry-After", String(Math.ceil(ra as number)));
      }
      return Response.json(body, { headers, status: error.status });
    }

    if (error instanceof Error) {
      const body: UnifiedErrorBody = {
        details: process.env.NODE_ENV === "production" ? undefined : error.message,
        message: "Internal Server Error",
        status: 500,
        timestamp: nowTimestamp(),
      };
      context.setStatus(500);
      return context.createResponse(body, { status: 500 });
    }

    const body: UnifiedErrorBody = {
      details: process.env.NODE_ENV === "production" ? undefined : String(error),
      message: "Internal Server Error",
      status: 500,
      timestamp: nowTimestamp(),
    };
    context.setStatus(500);
    return context.createResponse(body, { status: 500 });
  }
}
