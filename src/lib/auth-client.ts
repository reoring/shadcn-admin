export interface AuthSession {
  user: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
  expires: string
  error?: 'RefreshTokenError'
}

/**
 * Fetch the current Auth.js session.
 * In development, Vite proxies /api/auth/* to the auth service,
 * so all requests stay same-origin and cookies work correctly.
 * Returns null if not authenticated.
 */
export async function getSession(): Promise<AuthSession | null> {
  try {
    const res = await fetch('/api/auth/session')
    if (!res.ok) return null
    const session: AuthSession = await res.json()
    // Auth.js returns an empty object when there's no session
    if (!session.user || session.error === 'RefreshTokenError') return null
    return session
  } catch {
    return null
  }
}

/**
 * Fetch the CSRF token required by Auth.js for POST requests.
 */
export async function getCsrfToken(): Promise<string> {
  const res = await fetch('/api/auth/csrf')
  const data: { csrfToken: string } = await res.json()
  return data.csrfToken
}

/**
 * Initiate OIDC sign-in via the auth service.
 * This will redirect the browser to Keycloak.
 */
export async function signIn(
  provider: string = 'keycloak',
  callbackUrl?: string
) {
  const csrfToken = await getCsrfToken()

  // Build a form and submit it to trigger the redirect
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `/api/auth/signin/${provider}`

  const csrfInput = document.createElement('input')
  csrfInput.type = 'hidden'
  csrfInput.name = 'csrfToken'
  csrfInput.value = csrfToken
  form.appendChild(csrfInput)

  if (callbackUrl) {
    const callbackInput = document.createElement('input')
    callbackInput.type = 'hidden'
    callbackInput.name = 'callbackUrl'
    callbackInput.value = callbackUrl
    form.appendChild(callbackInput)
  }

  document.body.appendChild(form)
  form.submit()
}

/**
 * Sign out by posting to the auth service.
 */
export async function signOut(): Promise<void> {
  const csrfToken = await getCsrfToken()

  await fetch('/api/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken }),
  })
}
