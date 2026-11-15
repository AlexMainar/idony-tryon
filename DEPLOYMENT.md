The approved products use the mobile renderer on all browsers. Ethereal uses
`ethereal-film-09` in development and production. Comparison controls are
development-only.

Shopify has two unpublished test themes with distinct iframe destinations:

| Theme | ID | Script | Iframe base |
| --- | --- | --- | --- |
| DEV_Idony_Try-On | 189213442385 | `app/product.liquid` | `https://idonytryon.eu.ngrok.io/tryon` |
| Live_Idony Try-On | 194818965841 | `shopify/tryon-live-script.liquid` | `https://tryon.idonycosmetics.com/tryon` |

The script blocks are identical except for `TRYON_IFRAME_BASE`. The DEV theme
uses the local development server through ngrok. The LIVE test theme uses the
production build on Google Cloud. Neither theme is published by this workflow.

Cloud Run project/service: `idony-tryon`; region: `europe-west1`. The custom
domain `tryon.idonycosmetics.com` maps to this service. The main Shopify domain
`www.idonycosmetics.com` is separate.

Validate the production build and renderer checks, then commit and push. Build
the committed source as a no-traffic candidate first:

```bash
bash scripts/deploy-shopify-preview.sh
```

The script exports committed source, inherits runtime Shopify variables and
excludes local environment files and camera captures. Its `shopify-preview` tag
is an internal verification URL, not the destination used by the Shopify LIVE
theme. After verifying the candidate, promote the exact revision to the custom
domain:

```bash
gcloud run services update-traffic idony-tryon --project idony-tryon --region europe-west1 --to-revisions=REVISION_NAME=100 --quiet
```

This updates the backend behind the custom domain. Publishing a Shopify theme
remains a separate step controlled by the store owner. Roll back by assigning
100 percent to the previous revision recorded in the deployment traffic snapshot.
