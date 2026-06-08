/**
 * Mock 开关：优先级 `CUBE_AI_MOCK_<GROUP>` > `CUBE_AI_MOCK` > defaultOn。
 * `key` 第一段为 group，如 `api-keys.list` → env `CUBE_AI_MOCK_API_KEYS`。
 */

function envTruthy(value: string | undefined): boolean {
  if (value === undefined) return false
  const s = value.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

function mockGroupFromKey(key: string): string {
  const first = key.split('.')[0] ?? 'default'
  return first.toUpperCase().replace(/-/g, '_')
}

export function isMockEnabled(key: string, defaultOn: boolean): boolean {
  const group = mockGroupFromKey(key)
  const featureEnv = process.env[`CUBE_AI_MOCK_${group}`]
  if (featureEnv !== undefined) return envTruthy(featureEnv)
  const globalEnv = process.env['CUBE_AI_MOCK']
  if (globalEnv !== undefined) return envTruthy(globalEnv)
  return defaultOn
}
