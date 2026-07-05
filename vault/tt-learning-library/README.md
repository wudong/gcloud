# vault/tt-learning-library

**Project**: TT Learning Library — mobile-first PWA for table tennis tutorial video learning  
**Deployed**: 2026-07-05  
**Stack**: React + Vite + Hono + Kysely + PostgreSQL (Aiven) + Render

## Credentials Location

**Primary (GCP Secret Manager)**:
```
gcloud secrets versions access latest --secret="tt-learning-library-database-url"
gcloud secrets versions access latest --secret="tt-learning-library-full-config" | jq
```

**Secondary (local file)**:
`vault/tt-learning-library/secrets.md` (GITIGNORED)

## GCP Secrets

| Secret Name | Type | Description |
|---|---|---|
| `tt-learning-library-database-url` | database | Full Aiven PostgreSQL connection string |
| `tt-learning-library-aiven-db-password` | credential | Aiven DB user password |
| `tt-learning-library-aiven-account-password` | credential | Aiven account login password |
| `tt-learning-library-render-api-key` | api-key | Render API key for API access |
| `tt-learning-library-full-config` | config | Complete JSON with all deployment details |

## Live URLs

- **App**: https://tt-learning.onrender.com
- **API**: https://tt-learning-api.onrender.com
- **Repo**: https://github.com/wudong/tt-learning-library

## Architecture

```
Render Static Site (tt-learning)
  ├── rewrite /api/* → tt-learning-api
  └── SPA fallback to /index.html

Render Web Service (tt-learning-api)
  └── Aiven PostgreSQL (tt-learning-db, do-fra, free-1-1gb)
```
