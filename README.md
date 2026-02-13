# Shadcn Admin Dashboard

Admin Dashboard UI crafted with Shadcn and Vite. Built with responsiveness and accessibility in mind.

![alt text](public/images/shadcn-admin.png)

[![Sponsored by Clerk](https://img.shields.io/badge/Sponsored%20by-Clerk-5b6ee1?logo=clerk)](https://go.clerk.com/GttUAaK)

I've been creating dashboard UIs at work and for my personal projects. I always wanted to make a reusable collection of dashboard UI for future projects; and here it is now. While I've created a few custom components, some of the code is directly adapted from ShadcnUI examples.

> This is not a starter project (template) though. I'll probably make one in the future.

## Features

- Light/dark mode
- Responsive
- Accessible
- With built-in Sidebar component
- Global search command
- 10+ pages
- Extra custom components
- RTL support

<details>
<summary>Customized Components (click to expand)</summary>

This project uses Shadcn UI components, but some have been slightly modified for better RTL (Right-to-Left) support and other improvements. These customized components differ from the original Shadcn UI versions.

If you want to update components using the Shadcn CLI (e.g., `npx shadcn@latest add <component>`), it's generally safe for non-customized components. For the listed customized ones, you may need to manually merge changes to preserve the project's modifications and avoid overwriting RTL support or other updates.

> If you don't require RTL support, you can safely update the 'RTL Updated Components' via the Shadcn CLI, as these changes are primarily for RTL compatibility. The 'Modified Components' may have other customizations to consider.

### Modified Components

- scroll-area
- sonner
- separator

### RTL Updated Components

- alert-dialog
- calendar
- command
- dialog
- dropdown-menu
- select
- table
- sheet
- sidebar
- switch

**Notes:**

- **Modified Components**: These have general updates, potentially including RTL adjustments.
- **RTL Updated Components**: These have specific changes for RTL language support (e.g., layout, positioning).
- For implementation details, check the source files in `src/components/ui/`.
- All other Shadcn UI components in the project are standard and can be safely updated via the CLI.

</details>

## Tech Stack

**UI:** [ShadcnUI](https://ui.shadcn.com) (TailwindCSS + RadixUI)

**Build Tool:** [Vite](https://vitejs.dev/)

**Routing:** [TanStack Router](https://tanstack.com/router/latest)

**Type Checking:** [TypeScript](https://www.typescriptlang.org/)

**Linting/Formatting:** [ESLint](https://eslint.org/) & [Prettier](https://prettier.io/)

**Icons:** [Lucide Icons](https://lucide.dev/icons/), [Tabler Icons](https://tabler.io/icons) (Brand icons only)

**Auth:** Keycloak + Auth.js (dev BFF)

## Run Locally

Clone the project

```bash
  git clone https://github.com/satnaing/shadcn-admin.git
```

Go to the project directory

```bash
  cd shadcn-admin
```

Install dependencies

```bash
  devbox install
  devbox run -- bun install
```

Start the server

```bash
  devbox run -- bun run dev
```

## Keycloak Auth (Local Dev)

This repo includes a small Auth.js + Express "auth service" and a local Keycloak via Docker.

### 1) Start Keycloak

```bash
bun run infra:up
```

- Keycloak Admin UI: `http://localhost:8080/admin`
- Admin credentials (dev): `admin` / `admin`

### 2) Generate auth-service env

This generates `auth-service/.env` (not a root `.env`). It will:

- generate `AUTH_SECRET` (Auth.js signing secret) if missing (or still a placeholder)
- if `KEYCLOAK_CLIENT_SECRET` is missing (or still a placeholder), try to fetch it from the running Keycloak via the Admin API

```bash
bun run gensecret
```

If you changed Keycloak admin credentials:

```bash
KEYCLOAK_ADMIN_USERNAME=... KEYCLOAK_ADMIN_PASSWORD=... bun run gensecret
```

To force-regenerate only `AUTH_SECRET`:

```bash
bun run gensecret -- --force
```

To re-sync `KEYCLOAK_CLIENT_SECRET` from Keycloak (useful after `infra:reset`):

```bash
bun run gensecret -- --sync-keycloak-secret
```

### 3) Start auth service + SPA

In separate terminals:

```bash
bun run auth:dev
```

```bash
bun run dev
```

### 4) Create a user for login

We do not ship a default `testuser` / `testpassword` in the realm export.

Pick one:

- Use Keycloak registration (recommended): open the app, click Sign in, then use the "Register" link on the Keycloak login screen.
- Or create a user in Keycloak Admin UI: Users -> Add user -> Credentials -> Set password.

### One-shot init (Keycloak + env + test user)

If you want a single command that makes `testuser` / `testpassword` usable, run:

```bash
bun run auth:init
```

This will:

- start Keycloak via Docker
- generate/update `auth-service/.env`
- create (or update) a Keycloak user (defaults to `testuser` / `testpassword`)

To wipe and re-create Keycloak data:

```bash
bun run auth:init -- --reset
```

## Sponsoring this project ❤️

If you find this project helpful or use this in your own work, consider [sponsoring me](https://github.com/sponsors/satnaing) to support development and maintenance. You can [buy me a coffee](https://buymeacoffee.com/satnaing) as well. Don’t worry, every penny helps. Thank you! 🙏

For questions or sponsorship inquiries, feel free to reach out at [satnaingdev@gmail.com](mailto:satnaingdev@gmail.com).

### Current Sponsor

- [Clerk](https://go.clerk.com/GttUAaK) - authentication and user management for the modern web

## Author

Crafted with 🤍 by [@satnaing](https://github.com/satnaing)

## License

Licensed under the [MIT License](https://choosealicense.com/licenses/mit/)
