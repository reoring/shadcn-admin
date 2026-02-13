import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type EnvMap = Map<string, string>

function parseEnv(content: string): EnvMap {
  const map: EnvMap = new Map()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const idx = line.indexOf('=')
    if (idx === -1) continue

    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    map.set(key, value)
  }
  return map
}

function renderEnvFromTemplate(template: string, values: EnvMap): string {
  const keysInTemplate = new Set<string>()
  const outLines = template.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!match) return line

    const key = match[1]
    keysInTemplate.add(key)
    if (!values.has(key)) return line

    return `${key}=${values.get(key) ?? ''}`
  })

  const extras: string[] = []
  for (const [key, value] of values.entries()) {
    if (keysInTemplate.has(key)) continue
    extras.push(`${key}=${value}`)
  }

  if (extras.length > 0) {
    outLines.push('', ...extras)
  }

  let out = outLines.join('\n')
  if (!out.endsWith('\n')) out += '\n'
  return out
}

function generateAuthSecret(): string {
  return randomBytes(32).toString('base64')
}

function isPlaceholderAuthSecret(value: string) {
  const v = value.trim()
  if (!v) return true
  // If someone copied from docs/examples, replace with a real random secret.
  if (v.includes('change-in-production')) return true
  return false
}

function parseRealmFromIssuer(issuer: string): string | null {
  try {
    const url = new URL(issuer)
    const parts = url.pathname.split('/').filter(Boolean)
    const idx = parts.indexOf('realms')
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]
  } catch {
    // ignore
  }
  return null
}

async function fetchKeycloakClientSecret(opts: {
  issuer: string
  clientId: string
  adminUsername: string
  adminPassword: string
}): Promise<string | null> {
  let baseUrl: string
  try {
    baseUrl = new URL(opts.issuer).origin
  } catch {
    return null
  }

  const realm = parseRealmFromIssuer(opts.issuer)
  if (!realm) return null

  const tokenRes = await fetch(
    `${baseUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: opts.adminUsername,
        password: opts.adminPassword,
      }),
    }
  ).catch(() => null)

  if (!tokenRes?.ok) return null
  const tokenJson = (await tokenRes.json().catch(() => null)) as
    | { access_token?: string }
    | null
  const adminToken = tokenJson?.access_token
  if (!adminToken) return null

  const clientsRes = await fetch(
    `${baseUrl}/admin/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(opts.clientId)}`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        Accept: 'application/json',
      },
    }
  ).catch(() => null)

  if (!clientsRes?.ok) return null
  const clientsJson = (await clientsRes.json().catch(() => null)) as
    | Array<{ id?: string }>
    | null
  const internalId = clientsJson?.[0]?.id
  if (!internalId) return null

  const secretRes = await fetch(
    `${baseUrl}/admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(internalId)}/client-secret`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        Accept: 'application/json',
      },
    }
  ).catch(() => null)

  if (!secretRes?.ok) return null
  const secretJson = (await secretRes.json().catch(() => null)) as
    | { value?: string }
    | null
  return secretJson?.value ?? null
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const syncKeycloakSecret = args.includes('--sync-keycloak-secret')

function isPlaceholderSecret(value: string) {
  const v = value.trim()
  if (!v) return true
  // Common placeholder used in docs/examples
  if (v.includes('dev-secret-change-in-production')) return true
  return false
}

const rootDir = process.cwd()
const envExamplePath = path.join(rootDir, 'auth-service', '.env.example')
const envPath = path.join(rootDir, 'auth-service', '.env')

if (!existsSync(envExamplePath)) {
  console.error(`Missing template: ${envExamplePath}`)
  process.exit(1)
}

const template = readFileSync(envExamplePath, 'utf8')
const templateValues = parseEnv(template)

const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
const existingValues = existing ? parseEnv(existing) : new Map<string, string>()

const values: EnvMap = new Map(templateValues)
for (const [k, v] of existingValues.entries()) values.set(k, v)

let didWrite = false

const currentAuthSecret = values.get('AUTH_SECRET') ?? ''
if (force || isPlaceholderAuthSecret(currentAuthSecret)) {
  values.set('AUTH_SECRET', generateAuthSecret())
  didWrite = true
}

const issuer = values.get('KEYCLOAK_ISSUER') ?? ''
const clientId = values.get('KEYCLOAK_CLIENT_ID') ?? 'shadcn-admin-web'

const currentClientSecret = values.get('KEYCLOAK_CLIENT_SECRET') ?? ''
if ((syncKeycloakSecret || isPlaceholderSecret(currentClientSecret)) && issuer) {
  const adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME || 'admin'
  const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin'

  const fetchedSecret = await fetchKeycloakClientSecret({
    issuer,
    clientId,
    adminUsername,
    adminPassword,
  })

  if (fetchedSecret) {
    values.set('KEYCLOAK_CLIENT_SECRET', fetchedSecret)
    didWrite = true
  }
}

const nextEnv = renderEnvFromTemplate(template, values)
if (!existing || existing !== nextEnv) {
  writeFileSync(envPath, nextEnv, 'utf8')
  didWrite = true
}

if (didWrite) {
  console.log(`Updated: auth-service/.env`)
} else {
  console.log(`No changes: auth-service/.env`)
}

if (!(values.get('KEYCLOAK_CLIENT_SECRET') ?? '')) {
  console.log(
    'KEYCLOAK_CLIENT_SECRET is still empty. Start Keycloak and re-run, or copy it from the Keycloak admin UI.'
  )
  console.log('Tip: docker compose up -d')
}
