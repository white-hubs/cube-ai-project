import { Code, ConnectError } from "@connectrpc/connect";

export function isConnectError(err: unknown): err is ConnectError {
  return err instanceof ConnectError;
}

export function mapConnectErrorToHttpStatus(code: Code): number {
  switch (code) {
    case Code.Unauthenticated: {
      return 401;
    }
    case Code.PermissionDenied: {
      return 403;
    }
    case Code.NotFound: {
      return 404;
    }
    case Code.InvalidArgument: {
      return 400;
    }
    case Code.Unavailable:
    case Code.DeadlineExceeded: {
      return 503;
    }
    default: {
      return 502;
    }
  }
}

export function formatConnectErrorMessage(err: ConnectError): string {
  const hint =
    err.code === Code.Unauthenticated
      ? " Configure CUBE2_INTERNAL_INVOKE_SECRET_KEY (16 bytes), forward tenant/authorization headers, or OUAA client_credentials (CUBE2_OUAA_* / OUAA_REGISTRATION_*)."
      : "";
  return `cube2 gRPC ${Code[err.code] ?? err.code}: ${err.message}.${hint}`;
}
