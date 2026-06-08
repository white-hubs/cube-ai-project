import { describe, test, expect } from 'bun:test';
import { AgenticEngineError } from '../errors/agentic-error';
import { NacosSecretsLoader } from './nacos-secrets.loader';
import { SecretResolver } from './secret-resolver';

function makeResolver(secrets: Record<string, string>): SecretResolver {
  const loader = new NacosSecretsLoader({
    nacosAddress: 'http://localhost:8848',
    nacosNamespace: 'test',
    nacosUsername: 'nacos',
    nacosPassword: 'nacos',
  });
  loader.seedForTest(secrets);
  return new SecretResolver(loader);
}

describe('SecretResolver', () => {
  test('resolves single ${secret:KEY} placeholder', () => {
    const resolver = makeResolver({ DB_PASSWORD: 'pw123' });
    const result = resolver.resolve(
      'mysql://root:${secret:DB_PASSWORD}@host/db',
    );
    expect(result).toBe('mysql://root:pw123@host/db');
  });

  test('resolves multiple placeholders in same string', () => {
    const resolver = makeResolver({
      DB_USER: 'admin',
      DB_PASSWORD: 'secret',
    });
    const result = resolver.resolve(
      '${secret:DB_USER}:${secret:DB_PASSWORD}',
    );
    expect(result).toBe('admin:secret');
  });

  test('passes through string with no placeholders unchanged', () => {
    const resolver = makeResolver({});
    expect(resolver.resolve('no placeholders here')).toBe('no placeholders here');
  });

  test('throws UNAVAILABLE_SECRET_NOT_FOUND for missing placeholder key', () => {
    const resolver = makeResolver({});
    try {
      resolver.resolve('${secret:MISSING_KEY}');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AgenticEngineError);
      expect((e as AgenticEngineError).code).toBe('UNAVAILABLE_SECRET_NOT_FOUND');
    }
  });

  test('env AGENTIC_SECRET_* overrides seeded secret', () => {
    const prev = process.env.AGENTIC_SECRET_DB_PASSWORD;
    process.env.AGENTIC_SECRET_DB_PASSWORD = 'from-env';
    const resolver = makeResolver({ DB_PASSWORD: 'from-map' });
    expect(resolver.resolve('${secret:DB_PASSWORD}')).toBe('from-env');
    if (prev === undefined) delete process.env.AGENTIC_SECRET_DB_PASSWORD;
    else process.env.AGENTIC_SECRET_DB_PASSWORD = prev;
  });

  test('resolveObject() resolves string leaves', () => {
    const resolver = makeResolver({ API_KEY: 'key123' });
    const result = resolver.resolveObject({
      url: 'https://api.example.com',
      auth: '${secret:API_KEY}',
      timeout: 30,
    });
    expect(result.auth).toBe('key123');
    expect(result.url).toBe('https://api.example.com');
    expect(result.timeout).toBe(30);
  });

  test('resolveObject() recurses into nested objects', () => {
    const resolver = makeResolver({ DB_PASSWORD: 'nested_pw' });
    const result = resolver.resolveObject({
      db: { password: '${secret:DB_PASSWORD}' },
    });
    const nested = result as Record<string, Record<string, string>>;
    expect(nested['db']?.['password']).toBe('nested_pw');
  });

  test('resolveObject() exceeds max depth → throw', () => {
    const resolver = makeResolver({});
    let deep: Record<string, unknown> = { k: 'x' };
    for (let i = 0; i < 20; i++) {
      deep = { nest: deep as unknown as Record<string, unknown> };
    }
    expect(() => resolver.resolveObject(deep as Record<string, unknown>)).toThrow(
      'max depth',
    );
  });
});
