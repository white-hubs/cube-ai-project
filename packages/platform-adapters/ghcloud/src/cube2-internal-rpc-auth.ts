function readEnv(key: string): string | undefined {
  const raw = Bun.env[key] ?? process.env[key]
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

function readOuaaConfig(): { tokenUrl: string; clientId: string; clientSecret: string } | null {
  const tokenUrl =
    readEnv('CUBE2_OUAA_OAUTH2_TOKEN_URL') ??
    readEnv('OUAA_OAUTH2_TOKEN_URL') ??
    readEnv('GHCLOUD_OUAA_OAUTH2_TOKEN_URL')
  const clientId =
    readEnv('CUBE2_OUAA_CLIENT_ID') ??
    readEnv('OUAA_REGISTRATION_CLIENT_ID') ??
    readEnv('GHCLOUD_OUAA_REGISTRATION_CLIENT_ID')
  const clientSecret =
    readEnv('CUBE2_OUAA_CLIENT_SECRET') ??
    readEnv('OUAA_REGISTRATION_CLIENT_SECRET') ??
    readEnv('GHCLOUD_OUAA_REGISTRATION_CLIENT_SECRET')

  if (!tokenUrl && !clientId && !clientSecret) {
    return null
  }
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error(
      'cube2-internal-rpc-auth: OUAA client_credentials requires token URL, client id and client secret (CUBE2_OUAA_* or OUAA_REGISTRATION_* env)',
    )
  }
  return { tokenUrl, clientId, clientSecret }
}

let cachedAccessToken: string | null = null
let cachedExpiresAtMs = 0
let inflight: Promise<string> | null = null

async function fetchAccessToken(config: {
  tokenUrl: string
  clientId: string
  clientSecret: string
}): Promise<string> {
  const body = new URLSearchParams()
  body.set('grant_type', 'client_credentials')
  body.set('client_id', config.clientId)
  body.set('client_secret', config.clientSecret)

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`cube2-internal-rpc-auth: OUAA token request failed: ${response.status} ${text}`)
  }

  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  const accessToken = json.access_token
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    throw new Error('cube2-internal-rpc-auth: OUAA token response missing access_token')
  }

  let expiresInSec = 3600
  if (json.expires_in !== undefined && json.expires_in !== null) {
    const parsed =
      typeof json.expires_in === 'number' ? json.expires_in : Number.parseInt(String(json.expires_in), 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      expiresInSec = parsed
    }
  }

  cachedAccessToken = accessToken
  cachedExpiresAtMs = Date.now() + expiresInSec * 1000
  return accessToken
}

export async function getCube2InternalAccessToken(): Promise<string | undefined> {
  const config = readOuaaConfig()
  if (!config) {
    return undefined
  }

  const now = Date.now()
  if (cachedAccessToken && now < cachedExpiresAtMs - 30_000) {
    return cachedAccessToken
  }

  if (!inflight) {
    inflight = fetchAccessToken(config).finally(() => {
      inflight = null
    })
  }
  return inflight
}
