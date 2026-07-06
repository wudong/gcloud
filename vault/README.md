# Vault

Credentials and deployment details for projects.

## Structure

```
vault/
  <project-name>/
    README.md     # Non-sensitive overview (committed)
    secrets.md    # Full credentials (GITIGNORED)
```

## Projects

| Namespace | Description | Deployed |
|---|---|---|
| `gcloud` | GCP infrastructure — VM, Cloud SQL, Cloud Run, secrets | 2026-06-06 |
| `tt-players` | TT Players aggregator — UK league results and player statistics | 2026-07-05 |
| `tt-learning-library` | TT Learning Library PWA — tutorial video knowledge graph | 2026-07-05 |

## GCP Secret Manager

All secrets are stored in GCP Secret Manager (`wudong-agent-master`) with labels for project, type, and service.

### gcloud project secrets

| Secret | Type | Service | Description |
|---|---|---|---|
| `db-password` | database | cloud-sql | Main Cloud SQL password (Terraform-managed) |
| `cloudflare-dns-key` | api-key | cloudflare | Cloudflare API token for DNS management |
| `feedback-admin-token` | token | feedback-service | Admin dashboard Bearer token |
| `feedback-db-password` | database | feedback-service | Dedicated DB password for feedback service |

### tt-learning-library secrets

| Secret | Type | Description |
|---|---|---|
| `tt-learning-library-database-url` | database | Aiven PostgreSQL connection string |
| `tt-learning-library-aiven-db-password` | credential | Aiven DB user password |
| `tt-learning-library-aiven-account-password` | credential | Aiven account login |
| `tt-learning-library-render-api-key` | api-key | Render API key |
| `tt-learning-library-full-config` | config | Complete deployment JSON |

### tt-players secrets

| Secret | Type | Description |
|---|---|---|
| `tt-players-database-url` | database | Aiven PostgreSQL connection string |
| `tt-players-aiven-db-password` | credential | Aiven DB user password |
| `tt-players-render-api-key` | api-key | Render API key |
| `tt-players-full-config` | config | Complete deployment JSON |
