/**
 * Snowflake-style IDs as decimal strings (safe for JSON/JS; never use Number).
 *
 * Layout: 41-bit timestamp (ms since epoch) | 10-bit worker | 12-bit sequence
 * (fits in signed 64-bit; emitted as string to avoid any precision loss.)
 */

const CUSTOM_EPOCH_MS = 1577836800000 // 2020-01-01T00:00:00.000Z
const WORKER_BITS = 10n
const SEQ_BITS = 12n
const SEQ_MASK = (1n << SEQ_BITS) - 1n
const MAX_WORKER = (1n << WORKER_BITS) - 1n

function readWorkerIdFromEnv(): bigint {
  const raw = process.env.WORKER_ID ?? process.env.SNOWFLAKE_WORKER_ID ?? '0'
  const n = BigInt(raw)
  if (n < 0n || n > MAX_WORKER) {
    throw new Error(`WORKER_ID must be between 0 and ${MAX_WORKER.toString()}, got ${raw}`)
  }
  return n
}

const workerId = readWorkerIdFromEnv()

let lastTs = -1n
let sequence = 0n

function currentTs(): bigint {
  return BigInt(Date.now()) - BigInt(CUSTOM_EPOCH_MS)
}

function spinUntilNextMs(after: bigint): bigint {
  let t = currentTs()
  while (t <= after) {
    t = currentTs()
  }
  return t
}

/**
 * Returns the next Snowflake id as a decimal string.
 */
export function nextSnowflakeId(): string {
  let ts = currentTs()
  if (ts < 0n) {
    throw new Error('system time before Snowflake custom epoch')
  }

  if (ts < lastTs) {
    throw new Error('clock moved backwards; refuse to generate id')
  }

  if (ts === lastTs) {
    sequence = (sequence + 1n) & SEQ_MASK
    if (sequence === 0n) {
      ts = spinUntilNextMs(lastTs)
    }
  } else {
    sequence = 0n
  }

  if (ts < lastTs) {
    throw new Error('clock moved backwards after spin')
  }

  lastTs = ts
  const id = (ts << (WORKER_BITS + SEQ_BITS)) | (workerId << SEQ_BITS) | sequence
  return id.toString()
}

/** Stable API name for callers (see plan: SnowflakeUtil). */
export const SnowflakeUtil = {
  nextId: nextSnowflakeId,
}

/** @internal tests */
export function _resetSnowflakeStateForTests(): void {
  lastTs = -1n
  sequence = 0n
}
