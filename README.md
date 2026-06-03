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

1. **Become a Watch DOG** (`/enroll`) — submit the registration form. Writes a `Volunteers`
   row and seeds the 3-step `Enrollment` checklist.
2. **Schedule** (`/schedule`) — enter the email you just registered with, pick a day, and
   sign up. The day's count goes up. (An unregistered email is rejected with a "register
   first" message — that's expected.)

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
