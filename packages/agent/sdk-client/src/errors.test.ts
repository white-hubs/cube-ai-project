import { describe, expect, test } from 'bun:test';
import {
  AgenticClientError,
  SessionBusyError,
  StartTurnFailedError,
  StreamDisconnectedError,
  StoreDisposedError,
} from './errors';

/**
 * Unit tests for AgenticClientError.
 * Ref: P1-09 design doc §7 / sdk-core.md §12.1 T18/T19
 */
describe('AgenticClientError', () => {
  test('fromResponse: parses 5-field error envelope correctly', async () => {
    const body = {
      status:    403,
      code:      'PERMISSION_DENIED_GRANT_MISSING',
      message:   'Grant missing for this operation',
      details:   { traceId: 'abc123' },
      timestamp: 1745300000000,
    };
    const response = new Response(JSON.stringify(body), {
      status:  403,
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id':   'trace-from-header',
      },
    });

    const err = await AgenticClientError.fromResponse(response);

    expect(err).toBeInstanceOf(AgenticClientError);
    expect(err.code).toBe('PERMISSION_DENIED_GRANT_MISSING');
    expect(err.httpStatus).toBe(403);
    expect(err.message).toBe('Grant missing for this operation');
    expect(err.timestamp).toBe(1745300000000);
    expect(err.traceId).toBe('trace-from-header');
  });

  test('fromResponse: falls back gracefully for non-JSON response', async () => {
    const response = new Response('Internal Server Error', {
      status:  500,
      headers: { 'Content-Type': 'text/plain' },
    });

    const err = await AgenticClientError.fromResponse(response);

    expect(err).toBeInstanceOf(AgenticClientError);
    expect(err.code).toBeNull();
    expect(err.httpStatus).toBe(500);
  });

  test('AgenticClientError.code is a string (SNAKE_CASE)', () => {
    const err = new AgenticClientError(
      'RESOURCE_NOT_FOUND_SESSION',
      404,
      'Session not found',
      null,
      null,
      Date.now(),
    );
    expect(err.code).toMatch(/^[A-Z_]+$/);
    expect(err.name).toBe('AgenticClientError');
  });

  test('fromResponse: 409 RESOURCE_CONFLICT_TURN_RUNNING → SessionBusyError', async () => {
    const body = {
      status:    409,
      code:      'RESOURCE_CONFLICT_TURN_RUNNING',
      message:   'session already has a running turn',
      details:   null,
      timestamp: 1745300000000,
    };
    const response = new Response(JSON.stringify(body), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });

    const err = await AgenticClientError.fromResponse(response);
    expect(err).toBeInstanceOf(SessionBusyError);
    expect(err).toBeInstanceOf(AgenticClientError);
    expect(err.code).toBe('RESOURCE_CONFLICT_TURN_RUNNING');
    expect(err.httpStatus).toBe(409);
    expect(err.name).toBe('SessionBusyError');
  });

  test('fromResponse: 409 with message "already has a running turn" → SessionBusyError', async () => {
    const response = new Response('session already has a running turn', {
      status: 409,
      statusText: 'session already has a running turn',
    });
    const err = await AgenticClientError.fromResponse(response);
    expect(err).toBeInstanceOf(SessionBusyError);
  });

  test('fromResponse: 409 without busy signal → plain AgenticClientError', async () => {
    const body = {
      status: 409,
      code: 'RESOURCE_CONFLICT_DESCRIPTOR_VERSION',
      message: 'descriptor version conflict',
      details: null,
      timestamp: Date.now(),
    };
    const response = new Response(JSON.stringify(body), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
    const err = await AgenticClientError.fromResponse(response);
    expect(err).toBeInstanceOf(AgenticClientError);
    expect(err).not.toBeInstanceOf(SessionBusyError);
    expect(err.code).toBe('RESOURCE_CONFLICT_DESCRIPTOR_VERSION');
  });

  test('SessionBusyError.local() builds an instance without HTTP', () => {
    const err = SessionBusyError.local();
    expect(err).toBeInstanceOf(SessionBusyError);
    expect(err.code).toBe('RESOURCE_CONFLICT_SESSION_BUSY');
    expect(err.httpStatus).toBe(409);
  });

  test('StartTurnFailedError instanceof AgenticClientError', () => {
    const err = new StartTurnFailedError(
      'INTERNAL_UNKNOWN',
      500,
      'oops',
      null,
      null,
      Date.now(),
    );
    expect(err).toBeInstanceOf(StartTurnFailedError);
    expect(err).toBeInstanceOf(AgenticClientError);
    expect(err.name).toBe('StartTurnFailedError');
  });

  test('StreamDisconnectedError carries CLIENT_NETWORK code and instanceof chain', () => {
    const cause = new TypeError('fetch failed');
    const err = new StreamDisconnectedError('boom', cause);
    expect(err).toBeInstanceOf(StreamDisconnectedError);
    expect(err).toBeInstanceOf(AgenticClientError);
    expect(err.code).toBe('CLIENT_NETWORK_STREAM_DISCONNECTED');
    expect(err.cause).toBe(cause);
  });

  test('StoreDisposedError mentions method name', () => {
    const err = new StoreDisposedError('send');
    expect(err).toBeInstanceOf(StoreDisposedError);
    expect(err.message).toContain('send');
    expect(err.message).toContain('dispose');
  });
});
