#!/bin/bash
#
# Build and deploy aheswatchdogs.com to Azure (resource group `ahes`):
#   - Frontend  : Angular SPA  -> App Service `aheswatchdogs` (Linux, pm2 serve --spa)
#   - API       : Azure Functions -> Function App `aheswatchdogs-api`
#
# Usage:
#   ./deploy.sh         # deploy both (frontend + API)
#   ./deploy.sh web     # frontend only
#   ./deploy.sh api     # API only
#
# Requires: az (logged in), func (Azure Functions Core Tools), Node 22 (`nvm use`).

set -euo pipefail

RESOURCE_GROUP="ahes"
APP_NAME="aheswatchdogs"            # web app (SPA)
API_NAME="aheswatchdogs-api"        # function app

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/code"
API_DIR="$ROOT_DIR/api"
DIST_DIR="$WEB_DIR/dist/aheswatchdogs-com/browser"
ZIP_PATH="/tmp/aheswatchdogs-web.zip"

# pm2 ships on the Linux Node image. `--spa` rewrites unmatched routes to
# index.html so deep links (/schedule, /enroll, /admin) survive a refresh.
STARTUP_CMD="pm2 serve /home/site/wwwroot --no-daemon --spa"

TARGET="${1:-all}"   # all | web | api

# ---------- Auth ----------
if ! az account show &>/dev/null; then
  echo "🔐 Launching Azure login prompt..."
  az login
else
  echo "👤 Logged in as: $(az account show --query user.name -o tsv)"
fi

deploy_web() {
  echo
  echo "════════ FRONTEND (App Service: $APP_NAME) ════════"

  echo "🔧 Building Angular app (production)..."
  cd "$WEB_DIR"
  npm run build
  [ -d "$DIST_DIR" ] || { echo "❌ Build output not found at $DIST_DIR" >&2; exit 1; }

  echo "📦 Zipping build output..."
  rm -f "$ZIP_PATH"
  (cd "$DIST_DIR" && zip -rq "$ZIP_PATH" .)
  echo "   → $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"

  echo "⚙️  Ensuring SPA-fallback startup command..."
  current_startup=$(az webapp config show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
    --query appCommandLine -o tsv 2>/dev/null || echo "")
  if [ "$current_startup" != "$STARTUP_CMD" ]; then
    az webapp config set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
      --startup-file "$STARTUP_CMD" >/dev/null
    echo "   ✓ startup command set"
  else
    echo "   ✓ already set"
  fi

  echo "🚀 Deploying zip to App Service..."
  az webapp deploy --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
    --src-path "$ZIP_PATH" --type zip --clean true --restart true
  echo "   ✓ frontend deployed"
}

deploy_api() {
  echo
  echo "════════ API (Function App: $API_NAME) ════════"
  echo "🔧 Building Functions API..."
  cd "$API_DIR"
  npm run build

  echo "🚀 Publishing to Function App..."
  func azure functionapp publish "$API_NAME"
  echo "   ✓ API deployed"
}

case "$TARGET" in
  web) deploy_web ;;
  api) deploy_api ;;
  all) deploy_web; deploy_api ;;
  *) echo "Usage: ./deploy.sh [all|web|api]" >&2; exit 1 ;;
esac

echo
echo "✅ Done."
WEB_HOST=$(az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query defaultHostName -o tsv 2>/dev/null || echo "$APP_NAME.azurewebsites.net")
echo "   Site : https://$WEB_HOST  (custom domain: https://aheswatchdogs.com)"
echo "   API  : https://$API_NAME.azurewebsites.net/api"
