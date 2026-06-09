import { threadId } from 'node:worker_threads';

/** Twitter Snowflake 起始纪元（毫秒）。移植自 ghcloud ai-application util/generate-id。 */
const EPOCH_MS = 1288834974657;

const SEQUENCE_MASK = 0xfff;
const WORKER_MASK = 0x1f;
const MYSQL_BIGINT_SIGNED_MAX = 9223372036854775807n;

function readEnvUInt(key: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env[key] : undefined;
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const DATACENTER_ID = readEnvUInt('SNOWFLAKE_DATACENTER_ID', 0) & WORKER_MASK;
const WORKER_ID = (() => {
  const fromEnv = readEnvUInt('SNOWFLAKE_WORKER_ID', Number.NaN);
  if (Number.isFinite(fromEnv)) return fromEnv & WORKER_MASK;
  const pid = typeof process !== 'undefined' ? process.pid : 0;
  return (pid ^ (threadId * 31)) & WORKER_MASK;
})();

let lastTimestamp = -1;
let sequence = 0;

function tilNextMillis(last: number): number {
  let t = Date.now();
  while (t <= last) t = Date.now();
  return t;
}

/** 返回十进制字符串，与 BIGINT 主键的 string 表示对齐，避免 number 精度问题。 */
export function generateNumericId(): string {
  let timestamp = Date.now();
  if (timestamp < lastTimestamp) {
    throw new Error(`Snowflake clock moved backwards by ${lastTimestamp - timestamp}ms; refusing to generate id`);
  }
  if (timestamp === lastTimestamp) {
    sequence = (sequence + 1) & SEQUENCE_MASK;
    if (sequence === 0) timestamp = tilNextMillis(lastTimestamp);
  } else {
    sequence = 0;
  }
  lastTimestamp = timestamp;
  const delta = BigInt(timestamp - EPOCH_MS);
  const id = (delta << 22n) | (BigInt(DATACENTER_ID) << 17n) | (BigInt(WORKER_ID) << 12n) | BigInt(sequence);
  if (id <= 0n || id > MYSQL_BIGINT_SIGNED_MAX) {
    throw new Error(`Snowflake id out of MySQL BIGINT SIGNED range: ${id.toString()}`);
  }
  return id.toString();
}
