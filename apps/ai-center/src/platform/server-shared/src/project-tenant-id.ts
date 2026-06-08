/**
 * 租户对外 `projects.project_id`：不可预测的 URL 友好标识。
 * 格式：`prj_` + 21 位 Base62（0-9A-Za-z），总长 25。
 */

const PREFIX = 'prj_'
const RANDOM_LEN = 21

/** Base62：数字 + 大写 + 小写，与常见 NanoID 字符集兼容、便于放 URL。 */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** 256 % 62 = 8，拒绝 252–255 以保证对 62 取模无偏。 */
function nextBase62Char(): string {
  for (;;) {
    const b = new Uint8Array(1)
    crypto.getRandomValues(b)
    const v = b[0]!
    if (v < 252) return BASE62[v % 62]!
  }
}

export function generateTenantProjectId(): string {
  let tail = ''
  for (let i = 0; i < RANDOM_LEN; i++) tail += nextBase62Char()
  return `${PREFIX}${tail}`
}

export const TENANT_PROJECT_ID_PREFIX = PREFIX
export const TENANT_PROJECT_ID_RANDOM_LENGTH = RANDOM_LEN
