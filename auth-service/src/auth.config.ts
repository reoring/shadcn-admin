import type { ExpressAuthConfig } from "@auth/express"
import Keycloak from "@auth/express/providers/keycloak"

const REFRESH_TOKEN_WINDOW_SECONDS = 60
const REFRESH_TOKEN_ERROR = "RefreshTokenError" as const
const refreshLocks = new Map<string, Promise<SessionToken>>()

type SessionToken = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number | string
  error?: typeof REFRESH_TOKEN_ERROR
  sub?: string
}

async function refreshAccessToken(token: SessionToken): Promise<SessionToken> {
  if (!token.refreshToken) {
    return { ...token, error: REFRESH_TOKEN_ERROR }
  }

  const keycloakIssuer = process.env.KEYCLOAK_ISSUER
  const keycloakClientId = process.env.KEYCLOAK_CLIENT_ID
  const keycloakClientSecret = process.env.KEYCLOAK_CLIENT_SECRET

  if (!keycloakIssuer || !keycloakClientId || !keycloakClientSecret) {
    return { ...token, error: REFRESH_TOKEN_ERROR }
  }

  const tokenEndpoint = `${keycloakIssuer.replace(/\/$/, "")}/protocol/openid-connect/token`
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: keycloakClientId,
    client_secret: keycloakClientSecret,
    refresh_token: token.refreshToken,
  })

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })

  if (!response.ok) {
    return { ...token, error: REFRESH_TOKEN_ERROR }
  }

  const refreshed = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  return {
    ...token,
    error: undefined,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? token.refreshToken,
    expiresAt: Math.floor(
      Date.now() / 1000 + (Number(refreshed.expires_in) || 60 * 60)
    ),
  }
}

function shouldRefreshToken(token: SessionToken) {
  if (!token.expiresAt) return false
  const expiresAt = Number(token.expiresAt)
  if (Number.isNaN(expiresAt)) return false

  const now = Math.floor(Date.now() / 1000)
  return now >= expiresAt - REFRESH_TOKEN_WINDOW_SECONDS
}

export const authConfig: ExpressAuthConfig = {
  providers: [
    Keycloak({
      issuer: process.env.KEYCLOAK_ISSUER,
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account }) {
      // On initial sign in, persist OAuth tokens
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.expiresAt = account.expires_at
        token.error = undefined
        return token
      }

      if (!shouldRefreshToken(token as SessionToken)) {
        return token
      }

      const refreshToken = token.refreshToken as string | undefined
      if (!refreshToken) {
        return { ...token, error: REFRESH_TOKEN_ERROR }
      }

      // De-dup refresh attempts per refresh token (per-session).
      // Using only `sub` would incorrectly couple multiple sessions of the same user.
      const lockKey = token.sub
        ? `${token.sub as string}:${refreshToken}`
        : refreshToken
      const existing = refreshLocks.get(lockKey)
      if (existing) {
        return existing
      }

      const refreshPromise = refreshAccessToken(token as SessionToken)
        .then((refreshedToken) => {
          if (token.sub) {
            refreshedToken.sub = token.sub
          }
          return refreshedToken
        })
        .finally(() => {
          refreshLocks.delete(lockKey)
        })

      refreshLocks.set(lockKey, refreshPromise)
      return refreshPromise
    },
    async session({ session, token }) {
      // Expose minimal info to the session endpoint
      if (token.error) {
        ;(session as { error?: string }).error = String(token.error)
      }

      if (token.sub) {
        // `session.user` is optional in Auth.js types; ensure it exists.
        session.user = session.user ?? ({} as typeof session.user)
        ;(session.user as { id?: string }).id = token.sub
      }

      return session
    },
    async redirect({ url, baseUrl }) {
      const appUrl = process.env.APP_URL || "http://localhost:5173"
      // Allow redirects to the SPA
      if (url.startsWith(appUrl)) return url
      // Allow relative redirects
      if (url.startsWith("/")) return `${baseUrl}${url}`
      // Default: redirect to SPA
      return appUrl
    },
  },
  trustHost: true,
}
