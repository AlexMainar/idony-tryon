#!/usr/bin/env bash
# Deploy exactly the committed source to an isolated Cloud Run revision URL.
# Existing service traffic, runtime secrets and the public domain stay in place.
set -Eeuo pipefail

PROJECT_ID="${PROJECT_ID:-idony-tryon}"
REGION="${REGION:-europe-west1}"
SERVICE_NAME="${SERVICE_NAME:-idony-tryon}"
PREVIEW_TAG="${PREVIEW_TAG:-shopify-preview}"

cd "$(git rev-parse --show-toplevel)"
REVISION="$(git rev-parse --short=12 HEAD)"
ARTIFACT_DIR="$(mktemp -d /tmp/idony-preview.XXXXXX)"
SOURCE_DIR="$ARTIFACT_DIR/source"
mkdir -p "$SOURCE_DIR"
git archive HEAD | tar -x -C "$SOURCE_DIR"

gcloud run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" \
  --format='json(status.traffic,status.url)' > "$ARTIFACT_DIR/traffic-before.json"

gcloud run deploy "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" \
  --source "$SOURCE_DIR" --no-traffic --tag "$PREVIEW_TAG" \
  --revision-suffix "preview-$REVISION" --quiet

gcloud run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" \
  --format='json(status.traffic,status.url)' > "$ARTIFACT_DIR/traffic-after.json"

python3 - "$ARTIFACT_DIR" "$PREVIEW_TAG" <<'PY'
import json, pathlib, sys
folder=pathlib.Path(sys.argv[1]); tag=sys.argv[2]
before=json.loads((folder/'traffic-before.json').read_text())['status']['traffic']
after=json.loads((folder/'traffic-after.json').read_text())['status']['traffic']
def serving(traffic):
    result={}
    for entry in traffic:
        if entry.get('percent',0):
            revision=entry['revisionName']
            result[revision]=result.get(revision,0)+entry['percent']
    return result
if serving(before)!=serving(after):
    raise SystemExit('ERROR: Service traffic changed; inspect saved traffic snapshots.')
preview=next(entry for entry in after if entry.get('tag')==tag)
if preview.get('percent',0):
    raise SystemExit('ERROR: Preview unexpectedly receives service traffic.')
print('Public service traffic preserved:',serving(after))
print('Preview revision:',preview['revisionName'])
print('Shopify iframe URL:',preview['url']+'/tryon')
print('Deployment snapshots:',folder)
PY
