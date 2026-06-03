# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Web app for **aheswatchdogs.com** — a site for **Antelope Hills Elementary School (AHES)** Watch D.O.G.S. volunteers. The site is the one place where volunteers come for program information, to **sign up to become a Watch DOG**, and to **interact with others** in the program.

**The website replaces the paper brochure entirely** — it is not a companion to it. The brochure in [artifacts/](artifacts/) is the *source content to migrate into the site*, after which the site is the canonical version. Volunteers **sign up through the website**, and a light database tracks volunteer data (see "Data model" below). This means the site is **not** a pure static SPA like robbmorgan.com — it has a backend API and a data store.

Watch D.O.G.S. ("**Dads Of Great Students**") is a national K-12 program; AHES runs it as part of the **Antelope Hills Elementary PTA**. Fathers, mothers, grandparents, stepparents, aunts, uncles, guardians, and other caring adults serve on campus under a program coordinator and the school principal. The two program goals: (1) provide positive role models for students, and (2) provide extra eyes and ears for school security and safety.

- **Frontend:** Angular 21 + TypeScript 5.9, SCSS, client-side routing (SPA — no SSR). Mirrors the sibling project [../robbmorgan.com](../robbmorgan.com) — when a frontend convention isn't documented here, follow what that project does.
- **Backend:** **Azure Functions** (TypeScript) — a serverless HTTP API for sign-up + tracking.
- **Data store:** **Azure Table Storage** — a "light DB" for volunteer records. Cheap, schemaless, no server to manage.
- **Hosting (intended):** Azure App Service (Linux) serves the static Angular build via `pm2 serve --spa`; the Functions app is deployed separately. The SPA calls the Functions API over HTTPS.
- **Status:** working sign-up, schedule, and admin dashboard. The Angular app ([code/](code/)) and the Functions API ([api/](api/)) are in place: home / guidelines / enroll (registration form) / **schedule (shift sign-up)** / **admin (Google sign-in + coordinator roster)** / 404. Public `signup`/`shifts` + admin `manage/*` functions write to Table Storage; all verified end-to-end against Azurite. Still to do: wiring a real Google OAuth client for prod (see "Admin & authentication"), broader admin views (volunteers/enrollment), `deploy.sh`, and real branding assets. **Local run requires Node 22** (see "Node version"), **Azure Functions Core Tools** (`func`), and **Azurite** — but the easiest path is `npm run dev` from the repo root, which starts all three. See [README.md](README.md) for the full local-dev quickstart.

**Open design decision** (still undecided — don't assume an implementation):
- **Community / "interact with others"** — deferred. Not in scope for the first build; the initial focus is **info + sign-up + tracking**. Revisit before designing it.

## Source layout

- **[code/](code/)** — the Angular frontend. All `ng` / `npm` (frontend) commands run from here. Mirrors robbmorgan.com's `code/`. Sections live in `src/app/sections/<name>/`; the public sign-up call goes through [code/src/app/signup.service.ts](code/src/app/signup.service.ts); API base URL + Google client ID come from [code/src/environments/](code/src/environments/) (prod values swapped via `fileReplacements` in [angular.json](code/angular.json)).
- **[api/](api/)** — the Azure Functions app (TypeScript, v4 model). HTTP functions; its own `package.json` / `host.json` / `local.settings.json`. Functions: [signup.ts](api/src/functions/signup.ts) (registration), [auth.ts](api/src/functions/auth.ts) (passwordless code sign-in), [my.ts](api/src/functions/my.ts) (volunteer-tier schedule: roster + own shifts), [shifts.ts](api/src/functions/shifts.ts) (public counts), [admin.ts](api/src/functions/admin.ts) (coordinator). Table Storage access is centralized in [api/src/storage/tables.ts](api/src/storage/tables.ts); email sending (Azure Communication Services) in [api/src/email.ts](api/src/email.ts); volunteer session tokens in [api/src/session.ts](api/src/session.ts); code generation + `isActive` in [api/src/verification.ts](api/src/verification.ts); shared CORS/JSON helpers in [api/src/http.ts](api/src/http.ts).
- **Root** — [package.json](package.json) holds local-dev orchestration only (`npm run dev` runs Azurite + API + web via `concurrently`); see [README.md](README.md). The frontend dev server proxies `/api` to the Functions host ([code/proxy.conf.json](code/proxy.conf.json)), so dev is same-origin and `apiBaseUrl` is just `/api` in [environment.ts](code/src/environments/environment.ts) (full Function App URL in `environment.prod.ts`).

### API endpoints

| Method | Route | Tier | Purpose |
| --- | --- | --- | --- |
| POST | `/api/signup` | public | Create a volunteer as **pending** + seed enrollment checklist. Existing email → 409 `alreadyRegistered` (no email sent — they sign in at the schedule) |
| POST | `/api/auth/request-code` | public | `{ email }` → email a 6-digit login code to a registered volunteer. Unknown email → 404 `notRegistered` |
| POST | `/api/auth/verify-code` | public | `{ email, code }` → validate code, mark account **active**, return a **session token**. `410` expired, `429` too many attempts |
| GET | `/api/shifts?from=&to=` | public | Per-day **counts** only (no names/PII) for the logged-out view |
| GET | `/api/my/session` | volunteer | Validate the session token, return signed-in email |
| GET | `/api/my/shifts` | volunteer | The signed-in volunteer's own upcoming dates |
| POST | `/api/my/shifts` | volunteer | Sign **self** up for a date (idempotent upsert) |
| POST | `/api/my/shifts/remove` | volunteer | Remove **self** from a date |
| GET | `/api/my/roster?from=&to=` | volunteer | Per-day roster **names** (no email/PII), `isMe` flags the viewer |
| POST | `/api/my/account/delete` | volunteer | Delete **self**: all own shifts + enrollment row + volunteer record (cascade, idempotent) |
| GET | `/api/manage/me` | admin | Validate session, return signed-in email |
| GET | `/api/manage/schedule?from=&to=` | admin | Per-day **roster** with volunteer names + emails |
| POST | `/api/manage/shifts/remove` | admin | Remove any volunteer's shift sign-up |

Three tiers: **public** (signup, counts, request/verify code), **volunteer** (`my/*`, gated by a session token from code-login — see "Accounts, sign-in & email"), **admin** (`manage/*`, Google + allowlist — see "Admin & authentication"). Route prefix is `manage` not `admin` (the Functions host reserves `admin`).

**Schedule design decisions** (recorded so they're not silently reversed):
- **Three views of the same `Shifts` data, by tier:** logged-out → **counts only** (`/api/shifts`); signed-in volunteer → **roster names** + their own days, manage only their own (`/api/my/*`, names but **no emails**); admin → full roster with emails + remove anyone (`/api/manage/*`). Name (and email) are denormalized onto each `Shifts` row.
- **Signing up / removing / seeing names all require a volunteer session.** There is no public POST to `/api/shifts` anymore — you must sign in with an email code first. A valid session ⇒ the account is `active` (code-login is the email-ownership proof), so `my/*` needs no extra status check. Sign-up is **idempotent** per (date, volunteer): `Shifts` RowKey is the volunteer id.
- Volunteers manage **only their own** shifts — `my/shifts/remove` is keyed by the session's volunteer id, so one volunteer can never remove another. Removing others is admin-only.

**Schedule UI — calendar (desktop) + list (mobile), now a self-service portal.** `/schedule` renders a month-grid **calendar on desktop** and **list on mobile** (CSS `.desktop-only`/`.mobile-only`, breakpoint 820px) via the reusable [code/src/app/shared/month-calendar/](code/src/app/shared/month-calendar/) (owns the 6×7 grid, weekday header, prev/next nav; projects a `#dayCell` `<ng-template>` with context `date`, `day`, `inMonth`, `isPast`, `isToday`, `isWeekend`; emits `monthChange`). The page keeps a `Map<isoDate, …>` and lazily loads each month's range on `monthChange` (pruning the range before merging so removals disappear). **Logged out:** cells show counts only + a "Sign in with your email" card (email → 6-digit code) + Join link. **Logged in:** cells show counts, **your** days are highlighted ("You" tag), clicking a weekday opens a day panel with that day's **roster (names)** and a sign-up/remove-self button; a "My days" panel lists your upcoming days with Remove. Admin roster ([admin](code/src/app/sections/admin/)) is separate and shows full roster + emails.
- The repo root holds top-level config, a `deploy.sh`, and content sources in [artifacts/](artifacts/).
- **Asset workflow:** raw content (brochure, logos, photos, original PNG/JPG) lives in [artifacts/](artifacts/). Anything served gets copied to `code/public/`. Large images (>200 KB) are stored as **WebP** in `public/`, not the original PNG/JPG — see "Image formats" below.

## Node version

**Use Node 22 LTS** (currently v22.x). It's the version both Angular 21 and Azure Functions v4 support; the repo pins it in [.nvmrc](.nvmrc) and in the `engines` field of both [code/package.json](code/package.json) and [api/package.json](api/package.json) (`^20.19 || ^22.12`).

- This machine's system Node is an **odd/non-LTS version** (installed via Homebrew). Azure Functions rejects odd versions — `func start` printed `Incompatible Node.js version v25` under it. On Node 22 that warning is gone and the host runs clean.
- The project uses **nvm**. Run `nvm use` in the repo root (reads `.nvmrc`) before `npm`/`func` commands. `nvm install 22` if you don't have it; `nvm alias default 22` to make it the shell default.
- **Azure runtime must match.** Configure the deployed **Function App** for Node 22 (`linuxFxVersion` `NODE|22`, or app setting `WEBSITE_NODE_DEFAULT_VERSION` `~22`) so prod matches local. Set this when creating the Function App / in `deploy.sh`.

## Commands

> Run `nvm use` first (Node 22 — see "Node version" above).

**Everything at once (recommended for local testing)** — from the repo root:

| Task | Command |
| --- | --- |
| Install all (root + code + api) | `npm run install:all` |
| Run Azurite + API + web together | `npm run dev` |
| Build both frontend + API | `npm run build` |

`npm run dev` (root [package.json](package.json)) launches Azurite, the Functions host, and the Angular dev server via `concurrently`; open http://localhost:4200. Full walkthrough in [README.md](README.md). The per-project commands below are for working on one side in isolation.

Frontend — run from `code/`:

| Task | Command |
| --- | --- |
| Dev server (http://localhost:4200) | `npm start` |
| Production build | `npm run build` |
| Watch build (development config) | `npm run watch` |
| Unit tests (Vitest) | `npm test` |

Single test: `npm test` runs **Vitest** via `@angular/build:unit-test`. Filter with Vitest flags after `--`: `npm test -- -t "renders the title"` or `npm test -- src/app/app.spec.ts`.

Backend — run from `api/` (Azure Functions Core Tools):

| Task | Command |
| --- | --- |
| Local API (http://localhost:7071) | `npm start` (`func start`) |
| Build | `npm run build` |

In dev the SPA reaches the API through the Angular proxy (`/api` → `http://localhost:7071`); against Table Storage use **Azurite** (the local storage emulator) so you don't hit the live table. The storage connection string lives in `api/local.settings.json` (gitignored; `UseDevelopmentStorage=true` points at Azurite). Copy `api/local.settings.sample.json` if it's missing.

## Conventions (already applied — keep new code consistent)

The frontend was scaffolded to match robbmorgan.com; keep these conventions when extending it:

- **Angular 21**, standalone components (no `NgModule`). Bootstrap `main.ts` → `app.config.ts`; routes in `app.routes.ts`, all section routes `loadComponent`-lazy.
- **Builder:** `@angular/build:application` (Angular 21 unified builder, ESM + esbuild). Schematics targeting `@angular-devkit/build-angular:browser` may not apply.
- **Test runner: Vitest**, not Karma/Jasmine. Don't add `karma.conf.js`.
- **Component prefix** `app`; SCSS styling (`@schematics/angular:component` → `style: scss`).
- **Production budgets** in `angular.json`: initial bundle warn 500 kB / error 1 MB; per-component styles warn 10 kB / error 16 kB. Treat errors as real signals.
- `.gitignore` at the repo root already covers Angular/Node build artefacts; add `.DS_Store` handling per the editor.

For the **`api/` Functions app**:

- **Azure Functions, TypeScript, v4 programming model** (functions registered in code via `app.http(...)`, not `function.json` files). Node 20 runtime.
- HTTP-triggered functions only (no timers/queues for the first build). Keep handlers thin: validate input → read/write Table Storage via `@azure/data-tables` → return JSON.
- Split routes into **public** (the open sign-up `POST`) and **admin** (everything that reads/manages data), with shared auth middleware gating the admin routes — see "Admin & authentication" below.
- `local.settings.json` (gitignored) holds the storage connection string and any secrets. Never commit it. Use **Azurite** for local Table Storage.
- CORS: allow the SPA origin (localhost:4200 in dev, the production domain in prod).
- The SPA should read the API base URL from Angular environment config, not hard-code it.

## Data model (Azure Table Storage)

A "light DB" — schemaless tables keyed by `PartitionKey` + `RowKey`. One volunteer is the central record; enrollment status and shift sign-ups hang off it. Tracked scope: **registration, enrollment status, scheduling/shifts** (no on-campus visit/check-in log in the first build).

Proposed tables (adjust as the build firms up — this is the intended shape, not yet implemented):

| Table | Key | Fields | Source |
| --- | --- | --- | --- |
| `Volunteers` | PK `volunteer`, RK = generated id | Name, Email, Mobile, ShirtSize (S/M/L/XL/XXL) — **required**; Students, Availability — **optional** free text; CreatedAt; **Status (`pending`\|`active`), VerifiedAt, LoginCode, LoginCodeExpires, LoginCodeAttempts** (passwordless code sign-in) | The registration form (replaces the paper form) |
| `Enrollment` | PK = volunteer id, RK `status` | FormCompleted, PtaRegistered, TrainingVideosCompleted (the 3-step checklist), plus timestamps | "Enrollment checklist" below |
| `Shifts` | PK = date (`YYYY-MM-DD`), RK = volunteer id | Date, volunteer id, optional note | Scheduling — which volunteers are on campus which day |

Notes:
- Email is the natural human identifier but **don't use it as `RowKey`** (it changes, and Table Storage keys are immutable + have character limits) — generate a stable id, store email as a field. Email is **normalized to lowercase** on write and is **unique**: signup looks it up before insert and returns `409 alreadyRegistered` if found.
- **Status: `pending` → `active`.** New records are `pending`; the first successful **email-code sign-in** sets `active` + stamps `verifiedAt` (the code login is the email-ownership proof — there's no separate verify link). `isActive()` ([api/src/verification.ts](api/src/verification.ts)) treats a missing `status` as NOT active. `LoginCode`/`LoginCodeExpires`/`LoginCodeAttempts` hold the current 6-digit code; cleared on success.
- Shifts keyed by date as `PartitionKey` makes "who's on campus this day" a single fast partition query — the most common scheduling read.
- Enrollment mirrors the brochure's 3-step checklist exactly so the site can show each volunteer their remaining steps.

## Admin & authentication (BUILT)

Two endpoint tiers:

- **Public (unauthenticated):** `signup` and `shifts` — write-only create + counts-only reads. No PII returned.
- **Admin (authenticated):** the `manage/*` routes (coordinator dashboard). Gated by [api/src/auth.ts](api/src/auth.ts) `authenticateAdmin()`.

**How the gate works** — admin is **Google Sign-In + email allowlist**:

1. **Frontend** ([auth.service.ts](code/src/app/auth.service.ts)) uses Google Identity Services; on sign-in it gets a Google **ID token** and stores it. [adminAuthInterceptor](code/src/app/admin-auth.interceptor.ts) attaches it as `Authorization: Bearer <token>` to any `/api/manage/*` request. The token is validated by calling `GET /api/manage/me`.
2. **API** verifies each `manage/*` request: validates the ID token via `google-auth-library` `OAuth2Client.verifyIdToken` (signature, `aud` = our `GOOGLE_CLIENT_ID`, `exp`, `email_verified`), then checks the verified email against the **allowlist**. → `401` (no/invalid token) or `403` (not allowlisted).
3. **Allowlist** = app setting `ADMIN_ALLOWLIST` (comma-separated, lowercased). Defaults to `support@aheswatchdogs.com` if unset. **Add coordinator emails here — no redeploy needed.** Emails are matched case-insensitively.
4. **`GOOGLE_CLIENT_ID`** is config on both sides: frontend `environment.googleClientId`, API app setting (the expected `aud`). Not a secret, but keep it in config.

**⚠️ Route prefix is `manage`, NOT `admin`.** The Functions host reserves the `admin` route prefix for its own management API and rejects any function route starting with `admin`. The Angular *page* is still `/admin`; only the API routes are `/api/manage/*`.

**Real Google auth is CONFIGURED — Google-only, no dev bypass.** OAuth Web client ID `253413359966-8191ne4g1c7tgs1elksno6oceipljpjb.apps.googleusercontent.com` (authorized origins: `http://localhost:4200`, `https://aheswatchdogs.com`) is set in both `environment.ts` and `environment.prod.ts` (`googleClientId`) and in `local.settings.json` (`GOOGLE_CLIENT_ID`). The **Sign in with Google** button is the only way in, locally and in prod; the API verifies real tokens. Verified: bogus token → 401; the actual Google login needs a browser.

**Sign-in UI logic** ([admin.ts](code/src/app/sections/admin/admin.ts)): an `effect()` re-renders the Google button whenever the `#googleBtn` element appears — so the button comes back after **sign-out** (which destroys/recreates the sign-in card), not just on first load. Sign-out shows a "You've been signed out" confirmation.

> The earlier local dev bypass (`ALLOW_DEV_AUTH` + `dev:<email>` tokens) has been **removed** — both the API path and the UI shortcut are gone. Local testing uses the real Google button against `localhost:4200` (an authorized origin).

### Remaining for production

1. Set the Function App app settings: **`GOOGLE_CLIENT_ID`** = the client ID above, **`ADMIN_ALLOWLIST`** = `support@aheswatchdogs.com` (+ any coordinator emails).
2. Set `apiBaseUrl` in `environment.prod.ts` to the deployed Function App URL (still `REPLACE-ME`).
3. If the production origin ever changes from `https://aheswatchdogs.com`, add it to the OAuth client's Authorized JavaScript origins.

This is allowlist-based, not Workspace-domain — gated on the exact verified email, so personal Google accounts (like `support@aheswatchdogs.com`) work fine.

**Coordinator accounts.** The allowlist is currently just `support@aheswatchdogs.com` (the program's single address, used for everything including admin). This is a **confirmed personal Google account** (no Workspace) — so real "Sign in with Google" works for it as soon as `GOOGLE_CLIENT_ID` is configured; the allowlist gates on the exact email, which is exactly how a personal Google account behaves. Add Garrick Stein / Laura Allen / Robb Morgan to `ADMIN_ALLOWLIST` later if they each want individual logins (each needs its own Google account); otherwise everyone shares the `support@` login.

## Accounts, sign-in & email (BUILT)

Volunteers sign in to the **schedule portal** with a **passwordless 6-digit email code** (no Google — that's admin-only). Proving they can receive the code is the email-ownership check, so it doubles as account activation. This is the **single** ownership mechanism — there is no separate verify-link (an earlier link-based design was consolidated into the code).

**Flow:**
1. **Signup** ([signup.ts](api/src/functions/signup.ts)) just creates the volunteer as `status: 'pending'` (no email sent). The enroll page tells them to sign in at the schedule when ready.
2. **Sign in** — on `/schedule`, the volunteer enters their email → **`POST /api/auth/request-code`** ([auth.ts](api/src/functions/auth.ts)) emails a 6-digit code (10-min expiry, stored on the `Volunteers` row). They type it → **`POST /api/auth/verify-code`** validates it, sets `status: 'active'`, clears the code, and returns a **session token**.
3. **Session** = a **stateless HMAC-signed token** ([session.ts](api/src/session.ts), `SESSION_SECRET`), ~4-hour expiry, held in the browser's **`sessionStorage`** (gone when the tab closes — "session-based only"). The [volunteerAuthInterceptor](code/src/app/volunteer-auth.interceptor.ts) attaches it as `Authorization: Bearer …` to `/api/my/*` calls; [authenticateVolunteer()](api/src/session.ts) gates those routes (→ `401` on missing/expired/bad token).
4. **Manage** — signed in, the volunteer adds/removes **their own** days and sees each day's **roster names** (read-only for others) via `/api/my/*`. Code generation lives in [verification.ts](api/src/verification.ts) `newLoginCode()`; abuse guards: 6-digit random, 10-min TTL (`LOGIN_CODE_TTL_MS`), max 5 wrong attempts (`MAX_CODE_ATTEMPTS`) → `429`.
5. **Delete account** — `POST /api/my/account/delete` ([my.ts](api/src/functions/my.ts) `myAccountDelete`) cascades: removes every `Shifts` row for the volunteer, their `Enrollment` row, then the `Volunteers` record. The schedule's "Account" card gates it behind an inline **"Are you sure?"** confirm; on success the SPA signs out and shows an "account deleted" notice. Keyed by the session id, so a volunteer can only ever delete themselves.

**Sending: Azure Communication Services (ACS) Email — NOT the M365 mailbox.** [api/src/email.ts](api/src/email.ts) sends via `@azure/communication-email`. **Why not send "as" the support@ mailbox via Microsoft Graph?** That mailbox is **Microsoft 365 provisioned through GoDaddy**, and GoDaddy-managed M365 **does not give you Entra app-registration access** — so Graph app-only (`Mail.Send`) is impossible, in dev *and* prod. ACS sidesteps the locked tenant entirely: it lives in **our own Azure subscription** (RG `ahes`), proves domain ownership via **DNS** (which we control at GoDaddy), and only sends *outbound*. Inbound mail still flows to the M365 mailbox on its unchanged MX.
- **Sender:** a send-only address on a verified domain; **Reply-To = `support@aheswatchdogs.com`** (`MAIL_REPLY_TO`) so replies land in the real Outlook inbox.
- **Two tenants (don't confuse them):** Azure resources live in tenant `7368c58b…` (the `az login` tenant); the support@ mailbox lives in the GoDaddy M365 tenant `215ea289…`. ACS belongs to the **Azure** tenant.
- **Provisioned (RG `ahes`, all created via CLI):** Email Communication Service **`aheswatchdogs-email`** + an **Azure-managed domain** (instant, no DNS) → sender `DoNotReply@<guid>.azurecomm.net`; Communication Service **`aheswatchdogs-comms`** (linked to the domain) → its **connection string** is `ACS_CONNECTION_STRING`. Cost: pay-per-use only (~$0.25 / 1,000 emails), no standing fee.

**⚠️ Local dev needs no email setup.** If `ACS_CONNECTION_STRING` is absent, `email.ts` **logs the email (including the 6-digit code) to the API console instead of sending** — grab the code from the `npm run dev` output (`[email] ACS not configured…`). For real dev sending, put the ACS connection string in `local.settings.json` (it's already there).

**App settings** (Function App + `local.settings.json`): `ACS_CONNECTION_STRING`, `MAIL_SENDER` (the verified send-only address), `MAIL_REPLY_TO` (= `support@aheswatchdogs.com`), `SESSION_SECRET` (random 32+ chars, signs volunteer session tokens), and the temporary `MAIL_SENDER_APPLE` (see next).

**⚠️ Temporary iCloud workaround (`MAIL_SENDER_APPLE`).** iCloud/Apple is very slow to trust a brand-new sending domain — it **silently drops** mail from `mail.aheswatchdogs.com` (no bounce) until the domain warms up (typically hours–days). So `email.ts` `pickSender()` routes recipients on **`icloud.com` / `me.com` / `mac.com`** through the already-warmed Azure-managed domain (`MAIL_SENDER_APPLE`, the `…azurecomm.net` address that delivers to iCloud reliably); everyone else gets the branded `MAIL_SENDER`. **This is temporary** — once iCloud accepts the branded domain (verify via the delivery logs below), delete `MAIL_SENDER_APPLE` and all mail goes branded. Delivery diagnostics: ACS email logs flow to Log Analytics workspace **`ahes-logs`** (diagnostic setting `acs-email-diag` on `aheswatchdogs-comms`); query `EmailStatusUpdateOperational | project TimeGenerated, RecipientId, DeliveryStatus` to see per-recipient `Delivered`/`FilteredSpam`/`Bounced`/`Suppressed` (first-time ingestion can lag 10–30 min).

**Custom domain — DONE.** A **CustomerManaged** domain `mail.aheswatchdogs.com` is created under `aheswatchdogs-email`, fully **Verified** (Domain ownership + SPF + DKIM + DKIM2), and **linked** to `aheswatchdogs-comms` alongside the Azure-managed domain. A `notifications` sender username exists (display name **"AHES Watch D.O.G.S."**), so mail sends from **`AHES Watch D.O.G.S.` ‹notifications@mail.aheswatchdogs.com›** (Reply-To `support@aheswatchdogs.com`). The send-only address has no inbox/MX by design; replies route to support@ via Reply-To — no M365 alias needed. A subdomain was used deliberately so the records don't touch the root domain's existing Outlook/M365 mail.

DNS records added at GoDaddy (on the `mail` subdomain, so root-domain mail is untouched):
| Type | Host | Value |
| --- | --- | --- |
| TXT | `mail` | `ms-domain-verification=…` (ownership) |
| TXT | `mail` | `v=spf1 include:spf.protection.outlook.com -all` |
| CNAME | `selector1-azurecomm-prod-net._domainkey.mail` | `selector1-azurecomm-prod-net._domainkey.azurecomm.net` |
| CNAME | `selector2-azurecomm-prod-net._domainkey.mail` | `selector2-azurecomm-prod-net._domainkey.azurecomm.net` |
| TXT | `_dmarc.mail` | `v=DMARC1; p=none; rua=mailto:support@aheswatchdogs.com` |

### Remaining to turn on in prod

1. **Set the Function App settings** (`aheswatchdogs-api`): `ACS_CONNECTION_STRING` (from `az communication list-key -n aheswatchdogs-comms -g ahes`), `MAIL_SENDER=notifications@mail.aheswatchdogs.com`, `MAIL_SENDER_APPLE=DoNotReply@<azure-managed-domain>.azurecomm.net` (temporary iCloud workaround — remove once branded warms up), `MAIL_REPLY_TO=support@aheswatchdogs.com`, `SESSION_SECRET=<random 32+ chars>`.
2. **Deploy** the new API + frontend (`./deploy.sh`).

## Image formats

Production images served from `code/public/` are **WebP**, not PNG/JPG. Sources in [artifacts/](artifacts/) stay PNG/JPG. To add a served image:

```bash
python3 -c "from PIL import Image; Image.open('artifacts/foo.png').save('code/public/foo.webp', 'webp', quality=85, method=6)"
```

Then reference it as `.webp`. Small images (<200 KB) can stay PNG/JPG (favicon, small icons).

## Dev server quirk: new files in `public/`

The `@angular/build:application` builder enumerates `public/` assets at dev-server **startup**, not on file-watch. Files added to `public/` while `npm start` is running return **404** until you restart the dev server. Production builds pick them up fine.

## Public asset dir names must NOT collide with route paths (500 gotcha)

A directory in `code/public/` whose name equals a router path will **500 in production** on direct navigation under `pm2 serve --spa` (the static dir is matched before the SPA `index.html` fallback). It also blocks Google indexing of that route. When adding a `public/` subdirectory, make sure its name isn't one of the route paths in `app.routes.ts`. (This bit `/music` and `/novels` in robbmorgan.com.)

## Brand & visual identity

Palette comes from the **Antelope Hills Elementary PTA "Explorers" logo** — defined as CSS variables in [code/src/styles.scss](code/src/styles.scss):

- **Green is primary** (`--ah-green` / `--ah-green-deep` / `--ah-green-soft`) — headings, header/footer chrome, primary buttons, links, focus rings.
- **Red is the accent** (`--ah-red` / `--ah-red-deep`) — eyebrows, the nav call-to-action button, "Don'ts" heading, error/invalid states.
- Components still reference back-compat aliases (`--wd-purple*` → green, `--ah-maroon` → red); the alias values live at the top of `styles.scss`, so retheme there, not per-component.
- **Watch D.O.G.S.' own purple is NOT used in the site chrome** — it lives only in the Watch D.O.G.S. wordmark/logo art (when added). Two logos pair on the brochure: the Watch D.O.G.S. dog-in-sunglasses mark and the Explorers PTA mark.

## Domain reference (source of truth: the brochure in `artifacts/`)

This is the program content the site presents. The brochure is the **source content being migrated into the site**; once migrated, the **site is canonical** and the brochure is retired. Keep this section accurate to what the site shows.

### Enrollment checklist — how to become a Watch DOG

Three steps, all required before serving on campus:

1. **Watch D.O.G.S. Registration Form** — Name, Email, Mobile, Student(s), Availability, T-Shirt Size (S/M/L/XL/XXL). This is the site's primary sign-up flow: the form submits to the Functions API, which writes a `Volunteers` record and seeds an `Enrollment` row (see "Data model"). It replaces the paper form that was submitted to the AHES office. To pick days, the volunteer then **signs in at the schedule with an emailed 6-digit code** (see "Accounts, sign-in & email").
2. **Register with the Antelope Hills Elementary PTA** — the program is part of the PTA, so all volunteers must join. Registration link: `https://jointotem.com/ca/murrieta/antelope-hills-elementary-pta/join/register` (the brochure also has a QR code to this URL).
3. **Complete the required training videos** (must be done before volunteering). **Self-hosted** in Azure Blob Storage and embedded as `<video>` players in the enroll checklist (see "Large media on blob storage"). The brochure linked YouTube (`youtu.be/Z5lKDTEzTDw`, `youtu.be/-cnRwBwmHD0`) — now superseded by the self-hosted copies:
   - *Foundational Playground Practices* — `…/media/foundational-playground-practices.mp4`
   - *Supporting Conflict Resolution* — `…/media/supporting-conflict-resolution.mp4`

### Guidelines volunteers must follow

- **Hours & check-in:** Playground hours **9:30 AM – 1:20 PM**. Commit to a full recess block (~20 min). Check in/out at the front office and sign in/out through **Raptor** each visit. Notify playground staff on arrival and before leaving. Assist with Raptor Express Lanes at Friday Flag as directed. **Watch D.O.G.S. shirts must be worn** while serving.
- **Do's:** be a visible, positive presence; supervise actively (scan, walk, engage); help maintain safety and fair play; encourage kind words and inclusion; support and reinforce playground-staff expectations; follow staff directions; complete the required training videos.
- **Don'ts:** don't discipline students yourself (notify staff); no rough play / safety risks; no phone use except emergencies; don't leave your assigned area without telling staff; don't share personal contact info with students; don't leave early without checking out with the office and playground staff.

### Contacts

- General questions: **support@aheswatchdogs.com** (the site + admin email; the brochure listed `watchdogs.ahes@gmail.com`, now superseded)
- **Garrick Stein** — Principal / School Coordinator
- **Laura Allen** — Vice Principal
- **Robb Morgan** — Top Dog (program lead; repo owner)

## Large media on blob storage

Videos are **NOT** in `code/public/` — they're hosted in **Azure Blob Storage** and referenced as full HTTPS URLs in component data (same pattern as robbmorgan.com). Reason: `pm2 serve` (the Linux App Service static server) doesn't honor HTTP **Range** requests, and **Safari refuses to play `<video>` without Range support**. Blob Storage supports Range natively (verified: ranged GET → `206 Partial Content`).

- **Account/container:** `aheswatchdogsmedia` / `media`, in resource group **`ahes`** (westus), anonymous blob read enabled. Base URL: `https://aheswatchdogsmedia.blob.core.windows.net/media/`.
- **Current media:** the two training videos, embedded as `<video controls preload="metadata">` players in [enroll.ts](code/src/app/sections/enroll/enroll.ts) / [enroll.html](code/src/app/sections/enroll/enroll.html). Re-encoded to **720p H.264** + fast-start:
  - `foundational-playground-practices.mp4` (~50 MB, was 471 MB)
  - `supporting-conflict-resolution.mp4` (~37 MB, was 274 MB)
- **Source files** (original full-res) live in [artifacts/](artifacts/) but are **gitignored** (`artifacts/*.mp4`) — blob storage holds the optimized, served copies and is the system of record.
- **Two MP4 requirements for the served files** (both critical):
  1. **Fast-start** — the `moov` atom MUST be at the front, or the browser downloads almost the whole file before it can play/seek. Verify: `curl -s -r 0-262143 <url> | grep -aob moov` should report an offset near 0 (ours is 36).
  2. **Reasonable size** — re-encode to 720p; full-res screen-recordings are needlessly huge.
- **Add/replace a video** (encode → upload, both steps):
  ```bash
  # 1) Encode: 720p, H.264 CRF 23, AAC 128k, fast-start (lossy, big size win)
  ffmpeg -i "artifacts/<Source>.mp4" -vf "scale=-2:720" -c:v libx264 -preset medium \
    -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "/tmp/<name>.mp4"
  # (lossless alternative — keep quality, just fix streaming: -c copy -movflags +faststart)

  # 2) Upload (overwrite)
  KEY=$(az storage account keys list -g ahes -n aheswatchdogsmedia --query '[0].value' -o tsv)
  az storage blob upload --account-name aheswatchdogsmedia --account-key "$KEY" \
    -c media -n <name>.mp4 -f "/tmp/<name>.mp4" --content-type video/mp4 --overwrite
  ```
  Reference the full HTTPS URL in component data. Don't drop videos in `code/public/` — they'd "work" in Chrome but silently break Safari and bloat the deploy zip.

## Deployment (DONE — live)

**All Azure resources live in the `ahes` resource group** (westus): App Service plan `ahes` (B1 Linux) hosts both the web app **`aheswatchdogs`** (SPA) and the Function App **`aheswatchdogs-api`**; storage account `aheswatchdogsmedia` backs blob media + Table Storage + the Functions runtime. (robbmorgan.com uses RG `sdk` — this site is fully separate.)

- **Deploy with [deploy.sh](deploy.sh)** (run `nvm use` first): `./deploy.sh` (both), `./deploy.sh web`, or `./deploy.sh api`. Frontend → zip → `az webapp deploy` with `pm2 serve --spa`; API → `func azure functionapp publish aheswatchdogs-api`.
- **URLs:** SPA at `https://aheswatchdogs.com` (custom domain; the default host is regionalized: `aheswatchdogs-…westus-01.azurewebsites.net`). API at `https://aheswatchdogs-api.azurewebsites.net/api`.
- **Function App settings** (set via CLI, not committed): `GOOGLE_CLIENT_ID`, `ADMIN_ALLOWLIST=support@aheswatchdogs.com`, `ALLOWED_ORIGIN=https://aheswatchdogs.com`, `TABLES_CONNECTION_STRING` (aheswatchdogsmedia), and for email + volunteer sign-in `ACS_CONNECTION_STRING` / `MAIL_SENDER` (verified send-only address) / `MAIL_SENDER_APPLE` (iCloud fallback) / `MAIL_REPLY_TO=support@aheswatchdogs.com` / `SESSION_SECRET` (see "Accounts, sign-in & email"). Always On is enabled.
- **⚠️ CORS gotcha (cost us a debugging session):** the API is a different origin than the SPA, so the admin `/manage/*` calls are cross-origin **with an `Authorization` header**. The API's CORS `Access-Control-Allow-Headers` MUST include `Authorization` ([api/src/http.ts](api/src/http.ts)) — otherwise the browser's preflight silently blocks the authenticated request and the admin UI shows a misleading "not authorized" (it's really a CORS block, not a 403). Public signup/shifts worked throughout because they send no auth header. If admin sign-in fails but public pages work, check this first.
- **func publish has ~30-60s propagation lag** on the Linux dedicated plan — verify changes (e.g. CORS headers) with a `curl -X OPTIONS` after a short wait, not immediately.

Two deployables:

1. **Frontend** — mirrors robbmorgan.com. A `deploy.sh` at the repo root handles: `az login` check → `npm run build` (in `code/`) → zip the browser build output → idempotent `az webapp config set --startup-file 'pm2 serve … --spa'` → `az webapp deploy --type zip`. `pm2 serve --spa` is the Linux SPA-fallback (rewrites unmatched routes to `index.html`); don't use `web.config` (Windows App Service only). See [../robbmorgan.com/deploy.sh](../robbmorgan.com/deploy.sh) for the working reference.
2. **API** — the `api/` Functions app deploys separately to an Azure **Function App** (e.g. `func azure functionapp publish <name>` or `az functionapp deployment`). Its `AzureWebJobsStorage` / table connection string is set as an app setting in Azure (not committed). The SPA's production environment config points at the Function App's HTTPS URL; keep CORS on the Function App allowing the site origin.
