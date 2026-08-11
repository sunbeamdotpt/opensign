# Sunbeam Studios OpenSign Fork Changes

This document describes the modifications Sunbeam Studios has made to OpenSign in this fork. These changes are tailored for the SBBB✨ internal ecosystem and are **not supported for external use**.

## PostgreSQL support

The server has been adapted to run against PostgreSQL instead of MongoDB.

- `apps/OpenSignServer/migrationdb/index.js` and related migration scripts now support PostgreSQL as the backing database.
- The server uses `parse-server` with a PostgreSQL-compatible adapter configuration.

## Sunbeam SSO gateway integration (OIDC)

Administrators can sign in with SSO using the Sunbeam SSO gateway as the OIDC provider.

### Backend (`apps/OpenSignServer/auth/oidc.js`)

- New Express router at `/auth/oidc/*`:
  - `GET /auth/oidc/login` — initiates the OIDC authorization code flow with PKCE.
  - `GET /auth/oidc/callback` — exchanges the code for tokens, provisions the admin user, and creates a Parse session.
- Admin auto-provisioning:
  - When `OIDC_ADMIN_AUTO_PROVISION=true`, an SSO login from the configured `OIDC_ADMIN_DOMAIN` is automatically granted the `contracts_Admin` role.
  - The first SSO login creates the `_User`, `contracts_Users`, `partners_Tenant`, `contracts_Organizations`, and `contracts_Teams` records required by the OpenSign UI.
- Gateway identity lookup:
  - Optional M2M lookup against the Sunbeam SSO gateway fetches full identity traits (`name`, `given_name`, `middle_name`, `family_name`, `organization`, `company`, `job_title`, `locale`).
  - These traits populate the admin's display name, company, and job title on first login.

### Frontend (`apps/OpenSign/src/pages/Login.jsx`)

- Renders a **"Sign in with SSO"** button when `REACT_APP_OIDC_ENABLED=true`.
- Handles the OIDC callback (`?sessionToken=...`), establishes the Parse session, and skips the initial `/addadmin` setup flow when the backend has auto-provisioned an admin.

## Environment variables

The following variables are added or relevant to this fork. See `.env.example` for the full list.

| Variable | Purpose |
|---|---|
| `DATABASE_URI` | PostgreSQL connection URI (e.g. `postgres://user:pass@host:5432/opensign`). |
| `OIDC_ENABLED` | Enable the OIDC backend routes. |
| `OIDC_ISSUER` | Sunbeam SSO gateway base URL (e.g. `https://auth.sunbeam.pt`). |
| `OIDC_CLIENT_ID` | OIDC client ID registered in the gateway. |
| `OIDC_CLIENT_SECRET` | OIDC client secret. |
| `OIDC_REDIRECT_URI` | Callback URL (e.g. `https://opensign.sunbeam.pt/auth/oidc/callback`). |
| `OIDC_FRONTEND_REDIRECT` | URL to redirect the browser to after SSO completes. |
| `OIDC_ADMIN_AUTO_PROVISION` | `true` to create admin records on first SSO login. |
| `OIDC_ADMIN_DOMAIN` | Restrict auto-provision to this email domain. |
| `OIDC_SCOPES` | OIDC scopes; defaults to `openid email profile offline_access`. |
| `OIDC_IDENTITY_LOOKUP_ENABLED` | Enable M2M lookup of full gateway traits. |
| `OIDC_IDENTITY_CLIENT_ID` | M2M client ID for identity lookup. |
| `OIDC_IDENTITY_CLIENT_SECRET` | M2M client secret for identity lookup. |
| `OIDC_IDENTITY_SCOPE` | M2M scope for identity lookup; defaults to `identity:admin`. |
| `REACT_APP_OIDC_ENABLED` | Show the SSO button in the frontend. |

## Branching and releases

This fork tracks the latest upstream OpenSign tag and applies Sunbeam-specific changes on top. The current base tag is:

```
v2.41.1
```

Container images are built as multi-architecture images for internal deployment.
