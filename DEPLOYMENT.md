The approved products use the unified mobile renderer on all browsers. Ethereal
uses `ethereal-film-09` in both development and production builds. Comparison
controls remain development-only.

The Shopify preview uses this iframe base:

`https://shopify-preview---idony-tryon-ciiectq4ra-ew.a.run.app/tryon`

The try-on script in `app/product.liquid` matches the supplied Shopify script;
only `TRYON_IFRAME_BASE` changes from the ngrok URL. Copy that script into the
unpublished test theme. Publishing the Shopify theme is a separate manual step.
The exact script block is also available in
`shopify/tryon-preview-script.liquid` for copying without replacing the theme's
other product markup.

Validate the production build and renderer checks before committing/pushing.
Then deploy the committed source with:

```bash
bash scripts/deploy-shopify-preview.sh
```

The script targets project `idony-tryon`, service `idony-tryon`, region
`europe-west1`. It exports only committed files and deploys with `--no-traffic`
and tag `shopify-preview`. Existing runtime Shopify variables are inherited;
local environment files and camera captures are excluded from uploads.

The script verifies that the existing service traffic is preserved and prints
the preview revision URL. It does not change Shopify or the custom domain's
traffic. Future runs move the preview tag to the new committed revision.
