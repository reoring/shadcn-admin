import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

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

async function run(cmd: string, args: string[]) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (err) => {
      reject(err)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        const msg =
          stderr.trim() || stdout.trim() || `${cmd} exited with ${String(code)}`
        reject(new Error(msg))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitForOk(url: string, timeoutMs: number) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // ignore
    }
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for ${url}`)
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

async function getKeycloakAdminToken(opts: {
  baseUrl: string
  username: string
  password: string
}): Promise<string> {
  const tokenRes = await fetch(
    `${opts.baseUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: opts.username,
        password: opts.password,
      }),
    }
  )
  if (!tokenRes.ok) {
    throw new Error(
      `Failed to get Keycloak admin token (${tokenRes.status} ${tokenRes.statusText})`
    )
  }
  const json = (await tokenRes.json()) as { access_token?: string }
  if (!json.access_token) {
    throw new Error('Keycloak admin token missing access_token')
  }
  return json.access_token
}

async function ensureDevUser(opts: {
  baseUrl: string
  realm: string
  adminToken: string
  username: string
  password: string
  email: string
}) {
  const usersUrl = `${opts.baseUrl}/admin/realms/${encodeURIComponent(opts.realm)}/users?username=${encodeURIComponent(opts.username)}&exact=true`
  const listRes = await fetch(usersUrl, {
    headers: {
      Authorization: `Bearer ${opts.adminToken}`,
      Accept: 'application/json',
    },
  })
  if (!listRes.ok) {
    throw new Error(
      `Failed to query users (${listRes.status} ${listRes.statusText})`
    )
  }
  const listJson = (await listRes.json()) as Array<{ id?: string }>
  let userId = listJson?.[0]?.id

  if (!userId) {
    const createRes = await fetch(
      `${opts.baseUrl}/admin/realms/${encodeURIComponent(opts.realm)}/users`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: opts.username,
          enabled: true,
          email: opts.email,
          emailVerified: true,
          firstName: 'Test',
          lastName: 'User',
        }),
      }
    )

    if (!(createRes.status === 201 || createRes.status === 204)) {
      throw new Error(
        `Failed to create user (${createRes.status} ${createRes.statusText})`
      )
    }

    const location = createRes.headers.get('location') || ''
    const match = location.match(/\/([^/]+)$/)
    userId = match?.[1]

    if (!userId) {
      // Fallback: query again
      const retryRes = await fetch(usersUrl, {
        headers: {
          Authorization: `Bearer ${opts.adminToken}`,
          Accept: 'application/json',
        },
      })
      const retryJson = (await retryRes.json()) as Array<{ id?: string }>
      userId = retryJson?.[0]?.id
    }
  }

  if (!userId) {
    throw new Error('Could not determine Keycloak user id')
  }

  const resetRes = await fetch(
    `${opts.baseUrl}/admin/realms/${encodeURIComponent(opts.realm)}/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${opts.adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'password',
        temporary: false,
        value: opts.password,
      }),
    }
  )

  if (!resetRes.ok) {
    throw new Error(
      `Failed to set password (${resetRes.status} ${resetRes.statusText})`
    )
  }
}

const args = process.argv.slice(2)
const shouldReset = args.includes('--reset')

const rootDir = process.cwd()
const authEnvExamplePath = path.join(rootDir, 'auth-service', '.env.example')
if (!existsSync(authEnvExamplePath)) {
  throw new Error(`Missing template: auth-service/.env.example`)
}

const authEnvExample = readFileSync(authEnvExamplePath, 'utf8')
const authEnvDefaults = parseEnv(authEnvExample)

const issuer =
  process.env.KEYCLOAK_ISSUER ||
  authEnvDefaults.get('KEYCLOAK_ISSUER') ||
  'http://localhost:8080/realms/shadcn-admin'
const realm = parseRealmFromIssuer(issuer) || 'shadcn-admin'
const baseUrl = new URL(issuer).origin

const adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME || 'admin'
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin'

const devUsername = process.env.TEST_USERNAME || 'testuser'
const devPassword = process.env.TEST_PASSWORD || 'testpassword'
const devEmail = process.env.TEST_EMAIL || 'test@example.com'

if (shouldReset) {
  console.log('Resetting infra (docker compose down -v) ...')
  await run('docker', ['compose', 'down', '-v'])
}

console.log('Starting Keycloak (docker compose up -d) ...')
await run('docker', ['compose', 'up', '-d'])

console.log('Waiting for Keycloak to become ready ...')
await waitForOk(`${baseUrl}/`, 120_000)
await waitForOk(
  `${baseUrl}/realms/${encodeURIComponent(realm)}/.well-known/openid-configuration`,
  120_000
)

console.log('Generating auth-service/.env ...')
await run('bun', ['scripts/gensecret.ts', '--sync-keycloak-secret'])

console.log(`Ensuring dev user exists: ${devUsername}`)
const adminToken = await getKeycloakAdminToken({
  baseUrl,
  username: adminUsername,
  password: adminPassword,
})
await ensureDevUser({
  baseUrl,
  realm,
  adminToken,
  username: devUsername,
  password: devPassword,
  email: devEmail,
})

console.log('Done.')
console.log(`- Keycloak: ${baseUrl}`)
console.log(`- Realm: ${realm}`)
console.log(`- Test login: ${devUsername} / ${devPassword}`)
