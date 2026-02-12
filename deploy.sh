#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-idony-tryon}"
REGION="${REGION:-europe-west1}"
ENV_FILE="${ENV_FILE:-.env.local}"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $1"
    exit 1
  fi
}

confirm() {
  local prompt="$1"
  local answer
  read -r -p "$prompt [y/N]: " answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

load_env_var() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    return
  fi
  if [[ ! -f "$ENV_FILE" ]]; then
    return
  fi

  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return
  fi

  export "${key}=${line#*=}"
}

require_cmd git
require_cmd gcloud
require_cmd npm

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: This script must be run inside a git repository."
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "HEAD" ]]; then
  echo "ERROR: Detached HEAD detected. Checkout a branch before deploying."
  exit 1
fi

echo "Starting deployment for ${SERVICE_NAME} from branch ${BRANCH}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "WARNING: Working tree has uncommitted changes."
  if confirm "Create a commit with all current changes before deploy?"; then
    DEFAULT_MSG="chore: deploy $(date +"%Y-%m-%d %H:%M")"
    read -r -p "Commit message [${DEFAULT_MSG}]: " COMMIT_MSG
    COMMIT_MSG="${COMMIT_MSG:-$DEFAULT_MSG}"

    git add -A
    if git diff --cached --quiet; then
      echo "INFO: No staged changes to commit."
    else
      git commit -m "$COMMIT_MSG"
    fi
  else
    echo "ERROR: Deployment aborted. Commit your changes first."
    exit 1
  fi
fi

echo "Pushing ${BRANCH} to GitHub..."
git push origin "$BRANCH"

if [[ "${SKIP_LOCAL_BUILD:-0}" != "1" ]]; then
  echo "Running local production build check..."
  npm run build
fi

load_env_var "SHOPIFY_STORE_DOMAIN"
load_env_var "SHOPIFY_STOREFRONT_ACCESS_TOKEN"

if [[ -z "${SHOPIFY_STORE_DOMAIN:-}" || -z "${SHOPIFY_STOREFRONT_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_ACCESS_TOKEN."
  echo "   Set them in the shell or in ${ENV_FILE} and retry."
  exit 1
fi

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: No GCP project configured."
  echo "   Run: gcloud config set project <YOUR_PROJECT_ID>"
  exit 1
fi

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1)"
if [[ -z "${ACTIVE_ACCOUNT}" ]]; then
  echo "ERROR: No active gcloud account."
  echo "   Run: gcloud auth login"
  exit 1
fi

echo "Deploying to Cloud Run..."
echo "   Project: ${PROJECT_ID}"
echo "   Region:  ${REGION}"
echo "   Account: ${ACTIVE_ACCOUNT}"

gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source . \
  --allow-unauthenticated \
  --set-env-vars "SHOPIFY_STORE_DOMAIN=${SHOPIFY_STORE_DOMAIN},SHOPIFY_STOREFRONT_ACCESS_TOKEN=${SHOPIFY_STOREFRONT_ACCESS_TOKEN}"

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
echo "Deployment complete: ${SERVICE_URL}"
