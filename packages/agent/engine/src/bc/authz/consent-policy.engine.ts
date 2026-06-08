/**
 * ConsentPolicyEngine — evaluates Grant Args DSL (jsonpath-v1 subset).
 *
 * Supports operators: eq / ne / in / nin / eqCtx / neCtx / and / or
 * Does NOT support: startsWith, matchesRegex, lt, gt, filter predicates,
 *   recursive descent (..), slice — these are reserved for jsonpath-v2.
 *
 * Path evaluation: only simple dot-notation and bracket notation (no wildcards
 * except [*] which returns the full array).
 *
 * ref: docs/detailed-design/04-auth-and-authz/authorization-gateway.md §5
 *      docs/adr/ADR-0013-grant-args-constraint-dsl.md
 *      P1-05 prompt §6.4
 */
import type { ConsentArgsExpr, CtxReference } from '@cube-ai/contracts';

/**
 * Evaluation context passed to eqCtx / neCtx operators.
 * ref: authorization-gateway.md §5.5
 */
export interface EvalContext {
  'principal.userId'?: string;
  'principal.tenant'?: number;
  'session.agentId'?: string;
  'session.sessionId'?: string;
}

/**
 * Resolve a simple JSONPath-v1 expression against an object.
 * Returns undefined if the path does not exist.
 *
 * Supported syntax subset:
 *   $           → root
 *   .<key>      → property access (dot notation)
 *   ['<key>']   → property access (bracket notation)
 *   [<n>]       → array index
 *   [*]         → returns full array (for use with 'in')
 *
 * ref: authorization-gateway.md §5.2
 */
export function resolveJsonPath(root: unknown, path: string): unknown {
  if (!path.startsWith('$')) return undefined;

  const segments = tokenizePath(path.slice(1));
  let current: unknown = root;

  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    if (seg === '*') {
      if (Array.isArray(current)) return current;
      return undefined;
    }
    const key = seg.trim();
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Tokenize a JSONPath into segments (after the leading $) */
function tokenizePath(rest: string): string[] {
  const segments: string[] = [];
  let i = 0;
  while (i < rest.length) {
    if (rest[i] === '.') {
      i++;
      // dot notation: read until next . or [
      const start = i;
      while (i < rest.length && rest[i] !== '.' && rest[i] !== '[') i++;
      if (i > start) segments.push(rest.slice(start, i));
    } else if (rest[i] === '[') {
      i++;
      const start = i;
      while (i < rest.length && rest[i] !== ']') i++;
      const inner = rest.slice(start, i).trim();
      i++; // skip ]
      if (inner === '*') {
        segments.push('*');
      } else if (inner.startsWith("'") && inner.endsWith("'")) {
        segments.push(inner.slice(1, -1));
      } else if (inner.startsWith('"') && inner.endsWith('"')) {
        segments.push(inner.slice(1, -1));
      } else {
        segments.push(inner);
      }
    } else {
      i++;
    }
  }
  return segments;
}

/**
 * ConsentPolicyEngine evaluates ConsentArgsExpr against an args object.
 *
 * ref: authorization-gateway.md §5.6 execution semantics
 *
 * Key rules:
 *   - path resolution failure → sub-expression evaluates to false (never throws)
 *   - [*] + in → all elements must be in value array
 *   - and/or → short-circuit
 */
export class ConsentPolicyEngine {
  evaluate(
    expr: ConsentArgsExpr,
    args: Record<string, unknown>,
    ctx: EvalContext = {},
  ): boolean {
    try {
      return this.eval(expr, args, ctx);
    } catch {
      // Safety net: unexpected errors become false (never crash the gateway)
      return false;
    }
  }

  private eval(
    expr: ConsentArgsExpr,
    args: Record<string, unknown>,
    ctx: EvalContext,
  ): boolean {
    switch (expr.op) {
      case 'eq':
        return this.opEq(resolveJsonPath(args, expr.path), expr.value);
      case 'ne':
        return !this.opEq(resolveJsonPath(args, expr.path), expr.value);
      case 'in': {
        const val = resolveJsonPath(args, expr.path);
        if (Array.isArray(val)) {
          // [*] path: all elements must be in the value array
          return val.every(v => (expr.value as unknown[]).includes(v));
        }
        return (expr.value as unknown[]).includes(val);
      }
      case 'nin': {
        const val = resolveJsonPath(args, expr.path);
        if (Array.isArray(val)) {
          return val.every(v => !(expr.value as unknown[]).includes(v));
        }
        return !(expr.value as unknown[]).includes(val);
      }
      case 'eqCtx': {
        const pathVal = resolveJsonPath(args, expr.path);
        const ctxVal = this.resolveCtx(expr.ctx, ctx);
        return this.opEq(pathVal, ctxVal);
      }
      case 'neCtx': {
        const pathVal = resolveJsonPath(args, expr.path);
        const ctxVal = this.resolveCtx(expr.ctx, ctx);
        return !this.opEq(pathVal, ctxVal);
      }
      case 'and':
        return expr.exprs.every(e => this.eval(e, args, ctx));
      case 'or':
        return expr.exprs.some(e => this.eval(e, args, ctx));
    }
  }

  private opEq(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
  }

  private resolveCtx(ref: CtxReference, ctx: EvalContext): unknown {
    return ctx[ref];
  }
}
