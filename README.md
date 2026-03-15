# KomentoScript Pages Builder

Static site generator for KomentoScript packs in `sites/`.

> [!WARNING]  
> KomentoScript is in early-phase undergoing testing & can be subject to change. Documentation will be more limited during initial development & testing periods.


Build output includes:

- `/` root page with search and origin filtering
- `/data/all.json` merged KomentoScript JSON
- `/data/<id>.json` JSON for each pack ID

## Quick start

1. Install Node.js 20+.
2. Put your KomentoScript JSON packs into `sites/` (for more information read the <a href="./scripts/validation/schema/komentoscript-pack.schema.json">schema</a> or <a href="https://docs.hayami.moe/komento-script">documentation</a>).
3. Build the static site:

```bash
npm install
npm run build
```

Generated files are written to `dist/`.

## KomentoScript behavior in this project

This generator follows the following shape:

- Uses schema-first validation with JSON Schema + Ajv at build time.
- Validates top-level required fields, syntax/schema field names and rejects unsupported keys to catch authoring typos at build time.
- Validates target rules: `targetId`, `match.origins`, `mergeMode`, `placement` shape, and allowed extract keys.

## Folder layout

```text
sites/                  # Your source JSON packs
scripts/build.mjs       # Build-time generator
scripts/validation/     # Schema + validator modules
scripts/validation/schema/komentoscript-pack.schema.json  # JSON Schema
templates/root.html     # Home page HTML template
templates/assets/       # Static CSS/JS copied to dist/assets
```

## Deploy

### GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-github-pages.yml`.

1. In repository settings, enable Pages and set source to **GitHub Actions**.
2. Push to `main`.
3. The workflow builds and deploys `dist/`.

[![Deploy to GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-181717?logo=github&logoColor=white)](../../actions/workflows/deploy-github-pages.yml)

### Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`

[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://deploy.workers.cloudflare.com/?url=https://github.com/HayamiKomento/komentoscript-pages)

### Netlify

This repo includes `netlify.toml`.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/HayamiKomento/komentoscript-pages)


## Local preview

Any static server works. For example:

```bash
npx serve dist
```

Then open `/`, `/all`, and `/<id>` routes, where `<id>` is the pack ID from your JSON files.