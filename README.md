# AHES Watch D.O.G.S. — aheswatchdogs.com

Volunteer site for the Antelope Hills Elementary School Watch D.O.G.S. program: program
info, online sign-up, guidelines, and a shift schedule. Angular 21 SPA ([code/](code/)) +
Azure Functions API ([api/](api/)) backed by Azure Table Storage.

> Working notes, conventions, and architecture decisions live in [CLAUDE.md](CLAUDE.md).

## Prerequisites (one-time)

- **Node 22 LTS** — `nvm use` in this folder reads [.nvmrc](.nvmrc). (`nvm install 22` if needed.)
- **Azure Functions Core Tools** — `npm i -g azure-functions-core-tools@4`
- **Azurite** (local Table Storage emulator) — `npm i -g azurite`

## Install

```bash
nvm use            # Node 22
npm run install:all   # installs root + code/ + api/ dependencies
```

## Run it all locally (one command)

```bash
npm run dev
```

This starts three processes together (via `concurrently`):

| Name      | What                                   | URL                     |
| --------- | -------------------------------------- | ----------------------- |
| `azurite` | Local Table Storage emulator           | 127.0.0.1:10000-10002   |
| `api`     | Azure Functions host (`func start`)    | http://localhost:7071   |
| `web`     | Angular dev server                     | http://localhost:4200   |

Open **http://localhost:4200**. The dev server proxies `/api/*` to the Functions host
(see [code/proxy.conf.json](code/proxy.conf.json)), so the browser stays same-origin —
no CORS setup needed. Azurite stores data under `.azurite/` (gitignored); delete it to reset.

`Ctrl-C` stops all three.

## Try the full flow

1. **Join Watch D.O.G.S.** (`/enroll`) — submit the registration form. Writes a `Volunteers`
   row (status `pending`) and seeds the 3-step `Enrollment` checklist. No email is sent here.
2. **Sign in at the schedule** (`/schedule`) — enter that email → "Email me a code". A 6-digit
   code is sent via **Azure Communication Services**. If `ACS_CONNECTION_STRING` is set in
   `api/local.settings.json`, real mail goes out; if it's blank, there's **no real mail** — the API
   **logs the code to the `npm run dev` console** (look for `[email] ACS not configured…`). Enter
   the code to sign in (this also marks the account `active`).
3. **Manage your days** — signed in, click a weekday to see who's on and **sign yourself up** or
   **remove** yourself; the "My days" panel lists your upcoming days. Logged-out visitors see only
   per-day **counts** + the sign-in card.

> Sessions are sessionStorage-only (`SESSION_SECRET` signs them). Email sending uses ACS
> (`ACS_CONNECTION_STRING` / `MAIL_SENDER` / `MAIL_SENDER_APPLE` / `MAIL_REPLY_TO`) — see
> "Accounts, sign-in & email" in [CLAUDE.md](CLAUDE.md). Sending lives in the Azure tenant, not the
> GoDaddy-managed M365 tenant.

### Inspect the data

```bash
node -e '
const { TableClient } = require("@azure/data-tables");
const c = (t) => TableClient.fromConnectionString("UseDevelopmentStorage=true", t);
(async () => {
  for (const t of ["Volunteers", "Enrollment", "Shifts"]) {
    console.log("=== " + t + " ===");
    for await (const e of c(t).listEntities()) console.log(JSON.stringify(e));
  }
})();
' # run from api/ (needs @azure/data-tables from its node_modules)
```

## Other commands

| Command                       | What                                          |
| ----------------------------- | --------------------------------------------- |
| `npm run build`               | Production build of both frontend and API     |
| `npm --prefix code test`      | Frontend unit tests (Vitest)                  |
| `npm --prefix code start`     | Just the Angular dev server                   |
| `npm --prefix api start`      | Just the Functions host (builds first)        |
