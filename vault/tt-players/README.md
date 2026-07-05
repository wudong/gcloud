# vault/tt-players

**Project**: TT Players — UK table tennis results aggregator

**Credential backup added**: 2026-07-05

**Stack**: React + Vite + Fastify + Kysely + PostgreSQL (Aiven) + Render + Cloudflare DNS

## Credentials Location

Credentials are stored only in GCP Secret Manager. No local credential file is
maintained in this repository.

```bash
gcloud secrets versions access latest --secret="tt-players-database-url"
gcloud secrets versions access latest --secret="tt-players-full-config" | jq
```

## GCP Secrets

| Secret Name | Type | Description |
|---|---|---|
| `tt-players-database-url` | database | Full production Aiven PostgreSQL connection string |
| `tt-players-aiven-db-password` | credential | Password extracted from the production connection string |
| `tt-players-render-api-key` | api-key | Render API key used to manage both services |
| `tt-players-full-config` | config | Complete deployment inventory and verified credentials |

## Live Services

- **App**: https://tt-players.graceliu.uk
- **Render static site**: https://tt-players-hcde.onrender.com
- **Render API**: https://tt-players-api-mji9.onrender.com
- **Repository**: https://github.com/wudong/tt-players
- **Database**: Aiven PostgreSQL `tt-players-db`, `do-fra`

The Cloudflare credential available on the workstation was not archived because
it could not enumerate the account. Re-authenticate Wrangler with an appropriately
scoped token before treating Cloudflare access as recoverable.
