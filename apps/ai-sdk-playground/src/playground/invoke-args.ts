import type { CapabilityEntry, CapabilityParam } from './types';

function sortedParams(cap: CapabilityEntry): CapabilityParam[] {
  return [...cap.params].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function defaultValueFor(param: CapabilityParam): unknown {
  if (param.type === 'json') return {};
  if (param.type === 'number') return 0;
  if (param.type === 'boolean') return false;
  if (param.type === 'string') {
    if (param.name === 'sessionId' || param.name.endsWith('Id')) {
      return '1000000000000000001';
    }
    return '';
  }
  return undefined;
}

/** Build default JSON args object from capability param schema. */
export function defaultArgsForCapability(cap: CapabilityEntry): string {
  if (cap.kind === 'form-data') return '{}';

  const params = sortedParams(cap);
  if (params.length === 0) return '{}';

  const obj: Record<string, unknown> = {};
  for (const param of params) {
    if (param.type === 'form-data') continue;
    const value = defaultValueFor(param);
    if (value !== undefined && (param.required || param.name.endsWith('Id') || param.name === 'sessionId')) {
      obj[param.name] = value;
    } else if (param.type === 'json' && param.placement === 'query') {
      obj[param.name] = { limit: 20 };
    } else if (param.type === 'json' && param.required) {
      obj[param.name] = {};
    } else if (param.required) {
      obj[param.name] = value;
    }
  }

  if (cap.id === 'agent-sdk-client.sessions.list' && !('filter' in obj)) {
    obj.filter = { limit: 5 };
  }
  if (cap.id.includes('provideAssistant')) {
    return JSON.stringify(
      { defaultAgentId: '8300000000000000001', message: 'hello playground' },
      null,
      2,
    );
  }
  if (cap.id === 'agent-sdk-client-mock.startMockEngine') {
    return JSON.stringify({ scenarioName: 'health_up' }, null, 2);
  }

  return JSON.stringify(obj, null, 2);
}

/** Map playground JSON input to SDK method positional arguments. */
export function normalizeInvokeArgs(raw: unknown, cap: CapabilityEntry): unknown[] {
  const params = sortedParams(cap);
  if (params.length === 0) return [];

  if (raw == null || raw === '') {
    return params.map((p) => (p.required ? defaultValueFor(p) : defaultValueFor(p)));
  }

  if (Array.isArray(raw)) return raw;

  if (cap.kind === 'form-data' && typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.formData instanceof FormData) return [obj.formData];
  }

  if (typeof raw !== 'object' || raw === null) return [raw];

  const obj = raw as Record<string, unknown>;
  const positional = obj.__positional;
  if (Array.isArray(positional)) return positional;

  const namedKeys = Object.keys(obj).filter((k) => k !== '__positional');
  if (namedKeys.length === 0) {
    return params.map((p) => defaultValueFor(p));
  }

  const hasSchemaKeys = params.some((p) => p.name in obj);
  if (hasSchemaKeys) {
    return params.map((p) => {
      if (p.name in obj) return obj[p.name];
      return defaultValueFor(p);
    });
  }

  if (params.length === 1) {
    const only = params[0]!;
    if (only.type === 'json') return [obj];
    if (namedKeys.length === 1) return [obj[namedKeys[0]!]!];
  }

  if (namedKeys.length === 1) return [obj[namedKeys[0]!]!];
  return [obj];
}

export function placementLabel(placement: CapabilityParam['placement']): string {
  switch (placement) {
    case 'path':
      return 'path';
    case 'query':
      return 'query';
    case 'body':
      return 'body';
    default:
      return 'arg';
  }
}
