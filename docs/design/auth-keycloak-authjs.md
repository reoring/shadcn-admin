# Keycloak + Auth.js Authentication Design (Vite SPA)

Status: Draft
Last updated: 2026-02-13

## Context

This repository is a Vite + React SPA using TanStack Router.
Current auth-related code is UI-only and uses mocked state:

- `src/stores/auth-store.ts` stores a mock access token in a cookie.
- `src/features/auth/sign-in/components/user-auth-form.tsx` sets a mock user/token.
- `src/features/auth/sign-up/components/sign-up-form.tsx` does not actually create users.
- Protected routes are grouped under `src/routes/_authenticated/*`, but there is no real server-side session.

Goal is to use Keycloak as the identity provider (signup/login) and use Auth.js to manage the application session.

## Goals

- Support login and signup backed by Keycloak (OIDC).
- Keep the SPA free of secrets (client secret stays server-side).
- Provide a simple local dev experience with `docker compose up` for Keycloak dependencies.
- Use Auth.js session cookies (HttpOnly) so the SPA does not store access tokens.
- Make route protection work consistently with TanStack Router.

## Non-goals (for the first iteration)

- No user database adapter for Auth.js (use JWT strategy first).
- No custom Keycloak theme.
- No application business API is introduced yet (this is auth plumbing only).
- No multi-tenant realm management.

## High-level Architecture

Because this project is a SPA, Auth.js must run in a server environment.
We introduce a small "auth service" (BFF) that:

- runs Auth.js (`@auth/express`)
- integrates with Keycloak via the Auth.js Keycloak provider
- issues and validates the Auth.js session cookie
- exposes session endpoints the SPA can query

Components (local development):

- Public origin (Vite dev server): `http://localhost:5173`
  - Serves SPA assets
  - Proxies Auth.js routes: `http://localhost:5173/api/auth/*` -> `http://localhost:5174/api/auth/*`
- Auth service (Express, internal for dev): `http://localhost:5174`
- Keycloak (docker): `http://localhost:8080`
- Postgres for Keycloak (docker, internal)

Auth endpoints (served by the auth service):

- `GET /api/auth/session`
- `GET /api/auth/providers`
- `GET /api/auth/csrf`
- `POST /api/auth/signin/:provider`
- `POST /api/auth/signout`
- `GET /api/auth/callback/:provider`

Note: paths are configurable; this design assumes mounting Auth.js at `/api/auth/*`.

## Flows

### Login (OIDC Authorization Code)

1. User clicks "Sign in" in SPA.
2. SPA initiates sign-in by posting to Auth.js (`POST /api/auth/signin/keycloak`).
3. Vite proxies the request to the auth service.
4. Auth service redirects the browser to Keycloak authorization endpoint.
5. User authenticates on Keycloak.
6. Keycloak redirects back to `http://localhost:5173/api/auth/callback/keycloak`.
7. Vite proxies the callback request to the auth service.
8. Auth.js completes the flow, stores session in an HttpOnly cookie.
9. Auth.js redirects back to the SPA (callbackUrl).

### Signup

Signup is handled by Keycloak's built-in registration flow.

- Required Keycloak realm setting: enable "User registration".
- SPA "Sign up" page will start the same OIDC flow.
- Enhancement (optional): attempt to deep-link into the registration screen (Keycloak-specific).
- Fallback: user uses the "Register" link on Keycloak's login page.

### Logout

1. User triggers sign out in SPA.
2. SPA posts to `/api/auth/signout` (csrfToken required by Auth.js).
3. Auth.js clears the session cookie.
4. Optional enhancement: initiate Keycloak RP-initiated logout.

### Session check (route protection)

Protected route groups are under `src/routes/_authenticated/*`.
The SPA will use an async loader/guard to confirm session:

- Call `GET /api/auth/session` (same-origin to Vite; Vite proxies to the auth service).
- If session is missing, navigate to `/sign-in?redirect=<current>`.

This replaces the current "mock token" approach.

### Token refresh

Auth.js Keycloak provider returns tokens (access/refresh) during the callback.
The auth service is responsible for refresh-token rotation.

Design choice:

- Use Auth.js JWT session strategy initially.
- Store `access_token`, `refresh_token`, `expires_at` in the JWT.
- In the Auth.js `jwt` callback, refresh when the access token is expired (optionally with a small safety window).

Implementation details are in "Refresh Token Rotation (Keycloak)" below.

The SPA never reads tokens directly.

## Keycloak Design

### Docker Compose

We run Keycloak and its database using docker-compose.

- Keycloak image: `quay.io/keycloak/keycloak:<version>`
- Database: Postgres
- Keycloak command for dev: `start-dev --import-realm`
- Realm import mounted into `/opt/keycloak/data/import`

### Realm bootstrap

Add a realm export JSON in repo, e.g. `infra/keycloak/realm-export.json`, and mount it read-only.

The realm export should define:

- Realm name: `shadcn-admin` (example)
- Client: `shadcn-admin-web` (confidential)
- Valid redirect URIs:
  - `http://localhost:5173/api/auth/callback/keycloak`
- Web origins:
  - `http://localhost:5173`
- Users: do not commit default users/passwords to the repo (create users via Keycloak registration or admin UI)
- Realm roles (optional): `admin`, `user`

### Client settings (recommended)

- Client type: OpenID Connect
- Access type: Confidential
- Standard flow: enabled
- Direct access grants: disabled (not needed)
- PKCE: optional (Auth.js uses standard OIDC; enable if desired)

### Admin bootstrap

Use Keycloak bootstrap env vars in compose for local dev:

- `KC_BOOTSTRAP_ADMIN_USERNAME`
- `KC_BOOTSTRAP_ADMIN_PASSWORD`

## Auth Service Design (Express + Auth.js)

### Why a separate service

Auth.js requires a server runtime to:

- keep the Keycloak client secret private
- handle the OAuth callback
- set HttpOnly cookies

Vite cannot host Auth.js endpoints.

### Implementation outline

- Framework: Express
- Mount: `app.use("/api/auth/*", ExpressAuth(authConfig))`
- Provider: Auth.js Keycloak provider
- Secret: `AUTH_SECRET` (32+ random chars)
- Trust proxy: enable when behind reverse proxy in production

### Cookies and CORS

Default dev setup uses Vite proxy so the browser only talks to `http://localhost:5173`.
This avoids CORS entirely for the SPA.

If running without the dev proxy (SPA calls the auth service directly), then enable CORS:

- `Access-Control-Allow-Origin: http://localhost:5173`
- `Access-Control-Allow-Credentials: true`

### Redirect allowlist

Prevent open redirect vulnerabilities:

- Allow redirects only to known SPA origins (e.g. `http://localhost:5173` in dev).
- Use Auth.js `callbacks.redirect` to enforce.

## SPA Integration Design

### Replace mock auth state

- Deprecate `src/stores/auth-store.ts` as the source of truth.
- Use "session from auth service" as the source of truth.

The store may still exist for UI convenience, but it should be derived from `/api/auth/session` and not hold access tokens.

### Route guard

Add a guard at `src/routes/_authenticated/route.tsx` (or root layout) using TanStack Router's `beforeLoad`:

- If session exists: continue.
- If not: redirect to `/sign-in` with `redirect` search param.

### Sign in / Sign up pages

Update the existing pages to start the Keycloak OIDC flow via the auth service.

- `src/features/auth/sign-in/components/user-auth-form.tsx`:
  - remove mocked sleep + setUser/setAccessToken
  - call Auth.js sign-in endpoint (requires CSRF token)
- `src/features/auth/sign-up/*`:
  - change from "create account locally" to "start Keycloak registration"
  - fallback to normal sign-in flow with user clicking "Register" in Keycloak

### Sign out

- `src/components/sign-out-dialog.tsx` should call `/api/auth/signout` and then navigate to `/sign-in`.

## Configuration (env vars)

### Auth service (.env)

- `AUTH_SECRET=<32+ random chars>`
- `AUTH_URL=http://localhost:5173/api/auth` (external/public URL for Auth.js in dev)
- `KEYCLOAK_ISSUER=http://localhost:8080/realms/shadcn-admin`
- `KEYCLOAK_CLIENT_ID=shadcn-admin-web`
- `KEYCLOAK_CLIENT_SECRET=...` (dev secret)
- `APP_URL=http://localhost:5173`

### SPA (.env)

- (optional) `VITE_AUTH_BASE_URL=http://localhost:5174` only if the SPA calls the auth service directly (no Vite proxy)

## Dev Routing (Single Public Origin)

Decision: In development, we standardize on a single public origin (`http://localhost:5173`).
All Auth.js endpoints, including the OAuth callback, are accessed via Vite's proxy.

Requirements:

- Vite proxies `/api/auth/*` to the auth service.
- Keycloak client redirect URI uses the public origin:
  - `http://localhost:5173/api/auth/callback/keycloak`

Proxy notes:

- Prefer preserving the original `Host` header so Auth.js can infer the correct public URL.
- If a proxy changes the `Host`, set `AUTH_URL` to the public URL to avoid mismatches.

Example Vite proxy configuration (dev):

```ts
server: {
  proxy: {
    "/api/auth": {
      target: "http://localhost:5174",
      changeOrigin: false,
    },
  },
}
```

## Refresh Token Rotation (Keycloak)

We implement refresh token rotation in `callbacks.jwt` when using `session.strategy: "jwt"`.

Data stored in the Auth.js JWT token:

- `accessToken`: OAuth `access_token`
- `refreshToken`: OAuth `refresh_token`
- `expiresAt`: OAuth `expires_at` (seconds since epoch)
- `error`: optional refresh error marker

Refresh algorithm:

1. If this is the first sign-in (`account` exists), store tokens and return.
2. If `expiresAt` is missing, return (cannot refresh).
3. If `Date.now()` is still before `expiresAt` (optionally minus a small window), return.
4. Otherwise, POST to Keycloak token endpoint:

   - URL: `${KEYCLOAK_ISSUER}/protocol/openid-connect/token`
   - Body:
     - `grant_type=refresh_token`
     - `client_id=<clientId>`
     - `client_secret=<clientSecret>`
     - `refresh_token=<refreshToken>`

5. On success:

   - Update `accessToken`
   - Set `expiresAt = now + expires_in`
   - If a new `refresh_token` is returned, replace it; otherwise keep the old one

6. On failure:

   - Set `token.error = "RefreshTokenError"`
   - Optionally clear token fields to force re-authentication

Race condition note:

- Refresh tokens are often single-use. Multiple concurrent requests can attempt refresh at the same time.
- Mitigation (best-effort): in-memory per-user refresh lock within a single auth-service instance.
- If this becomes an issue in production, switch to a database-backed session strategy.

SPA handling:

- Surface `token.error` via the Auth.js `session` callback (e.g. `session.error`).
- If the SPA observes `RefreshTokenError`, it should redirect the user to sign-in.

## Production Deployment

Decision: Prefer same-origin deployment.

### Recommended: Same origin (no CORS)

- Public URL: `https://app.example.com`
- Serve SPA and proxy Auth.js under the same origin:
  - `https://app.example.com/api/auth/*` -> auth-service internal

Auth.js / server settings:

- Set `AUTH_TRUST_HOST=true` (or `trustHost: true`) when behind a reverse proxy.
- In Express, enable `app.set("trust proxy", true)` so `X-Forwarded-Proto` is respected.

Keycloak redirect URIs:

- `https://app.example.com/api/auth/callback/keycloak`

Cookie expectations:

- `Secure` cookies (HTTPS)
- `HttpOnly`
- `SameSite=Lax` is typically sufficient for OIDC top-level redirects

### Alternative: Separate origins (CORS required)

- SPA: `https://app.example.com`
- Auth service: `https://auth.example.com`
- SPA calls `https://auth.example.com/api/auth/*` with `credentials: "include"`.

Requirements:

- Enable CORS on auth-service:
  - `Access-Control-Allow-Origin: https://app.example.com`
  - `Access-Control-Allow-Credentials: true`
- Keep both on the same registrable domain (example.com) to avoid third-party cookie issues.


## Local development runbook

1. Start Keycloak dependencies:
   - `docker compose up -d`
2. Start auth service:
   - `bun run auth:dev` (script to be added)
3. Start SPA:
   - `bun run dev`
4. Visit:
   - SPA: `http://localhost:5173`
   - Keycloak admin: `http://localhost:8080/admin`

## Migration plan

1. Add docker-compose for Keycloak + Postgres + realm import.
2. Add auth service (Express + Auth.js Keycloak provider).
3. Wire SPA pages and route guards to auth service.
4. Remove or quarantine mock auth paths and Clerk demo routes (optional cleanup).

## Risks / Notes

- `@auth/express` is experimental; expect API adjustments when upgrading.
- Signup deep-linking into Keycloak registration may be Keycloak-version-specific.
- Production deployment should use HTTPS and `Secure` cookies; dev uses HTTP.
