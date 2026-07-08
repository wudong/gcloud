# AGENTS.md

Reference for AI coding agents (and humans) working in this repo. It documents
the GCP infrastructure, the Cloud Run deploy pipeline, the design decisions, and
the gotchas that bit us during setup so you don't relearn them.

---

## 1. What this repo is

Terraform-managed GCP infrastructure for the personal project
`wudong-agent-master` (Always-Free-tier-leaning). It also contains the source
for one Cloud Run app (`feedback-service`) and the GitHub Actions workflow that
deploys it.

- **GCP project:** `wudong-agent-master` (number `126174378735`)
- **Region/zone:** `us-central1` / `us-central1-a`
- **GitHub repo:** `wudong/gcloud` (SSH)

### Repo layout

```
.
├── main.tf                 # Core infra: project, APIs, VPC, VM, Storage, Cloud SQL
├── feedback-service.tf     # Cloud Run service skeleton + Artifact Registry + secrets + SA
├── workload-identity.tf    # Workload Identity Federation for GitHub Actions
├── variables.tf            # Variables (incl. github_repo)
├── outputs.tf              # Outputs
├── terraform.tfvars        # Sensitive values (gitignored) — billing account, github_repo
├── backend.tf              # Local state backend
├── feedback-service/       # The Cloud Run app (Bun + Hono) + Dockerfile + deploy.sh
└── .github/workflows/deploy-feedback-service.yml   # CI: build → push → deploy
```

---

## 2. The deploy model (the most important concept)

**Terraform owns the service *skeleton*; CI owns the *image*.**

- Terraform manages everything about `feedback-service` Cloud Run **except the
  container image**: region, ingress, auth (public `allUsers`), autoscaling,
  env vars, Secret Manager secret mounts, the Cloud SQL connection, the runtime
  service account, and IAM.
- The image is in `lifecycle.ignore_changes`. So CI (or a manual
  `gcloud run services update --image=…`) can swap the image freely and
  `terraform plan` stays clean — Terraform won't try to revert it.

A deploy is therefore just an image swap:

```bash
gcloud run services update feedback-service \
  --image=us-central1-docker.pkg.dev/wudong-agent-master/feedback-service/feedback-service:sha-XXXXXXX \
  --region=us-central1 --project=wudong-agent-master
```

CI does exactly this (see §5).

> If you ever want Terraform to *also* own the image tag, remove the image from
> `ignore_changes` and pass the tag via a variable — but then every deploy must
> go through `terraform apply`, which is slower and couples deploys to infra.

---

## 3. Resources Terraform manages (the feedback-service stack)

File: `feedback-service.tf`

| Resource | Purpose |
|---|---|
| `google_project_service.run` | Cloud Run Admin API (imported, was enabled out-of-band) |
| `google_project_service.artifactregistry` | Artifact Registry API (imported) |
| `google_artifact_registry_repository.feedback_service` | Docker repo `feedback-service` in `us-central1`. Has a **cleanup policy**: keep latest 3 tagged versions, delete untagged images > 7 days. This keeps stored bytes under the **0.5 GB-month free tier**. |
| `google_service_account.feedback_service` | Runtime SA `feedback-service-sa@…` (imported; originally created manually) |
| `google_project_iam_member.feedback_sa_cloudsql_client` | `roles/cloudsql.client` |
| `google_project_iam_member.feedback_sa_cloudsql_instanceuser` | `roles/cloudsql.instanceUser` |
| `google_project_iam_member.feedback_sa_secret_accessor` | `roles/secretmanager.secretAccessor` (project-wide; needed to mount secrets at runtime) |
| `google_secret_manager_secret.feedback_db_password` | Secret container `feedback-db-password` (imported; value/versions NOT managed by TF) |
| `google_secret_manager_secret.feedback_admin_token` | Secret container `feedback-admin-token` (imported; value/versions NOT managed by TF) |
| `google_secret_manager_secret_iam_member.*_sa` | Secret-level accessor grants for the runtime SA |
| `google_cloud_run_v2_service.feedback_service` | The Cloud Run service (imported). See §4. |
| `google_cloud_run_v2_service_iam_member.feedback_invoker` | `roles/run.invoker` for `allUsers` (public, unauthenticated access) |

File: `workload-identity.tf` (all new — see §6)

### Secrets intentionally NOT fully managed by Terraform

The `google_secret_manager_secret` resources manage only the **container**
(replication, IAM). The secret **values/versions are set out-of-band** so
plaintext never lands in Terraform state. Set/rotate them with:

```bash
echo -n "VALUE" | gcloud secrets versions add feedback-db-password --data-file=- --project=wudong-agent-master
```

### Secrets still outside Terraform (drift risk — import if you want TF to own them)

These exist in Secret Manager but are **not** in Terraform state, so a future
`terraform plan` won't protect them. Candidates to import later:

`cloudflare-dns-key`, `court-booker-turso-auth-token`, and all
`tt-learning-*` / `tt-players-*` secrets.

Import pattern (container only, no version):

```bash
terraform import google_secret_manager_secret.NAME "projects/wudong-agent-master/secrets/SECRET_ID"
```

> ⚠️ **Secret Manager free tier is 6 active secret versions/month.** There are
> currently ~14 secrets, so this project is likely already past the free tier
> (cents/month). Not a problem, but be aware.

---

## 4. Cloud Run service configuration (what TF owns)

`google_cloud_run_v2_service.feedback_service`:

- **Image:** `us-central1-docker.pkg.dev/wudong-agent-master/feedback-service/feedback-service:latest` (ignored after create)
- **Ingress:** `INGRESS_TRAFFIC_ALL`, public (`allUsers` invoker)
- **Runtime SA:** `feedback-service-sa@…`
- **Scaling (autoscaling):** `min_instance_count=0`, `max_instance_count=5`, `max_instance_request_concurrency=80`, `timeout=30s`
- **Resources:** `cpu=1`, `memory=256Mi`, **`cpu_idle=true`** (request-based CPU — *required* because memory < 512Mi; see gotcha §8)
- **Cloud SQL:** a `cloud_sql_instance` volume + a `volume_mounts` at **`/cloudsql`** (the app connects via the unix socket `host=/cloudsql/<INSTANCE_CONNECTION_NAME>`, NOT TCP — see gotcha §8)
- **Env:**
  - `INSTANCE_CONNECTION_NAME` = `wudong-agent-master:us-central1:wd-agents-pg`
  - `DB_USER` = `feedback-service`
  - `DB_NAME` = `app-db`
  - `DB_PASS` → **Secret Manager** `feedback-db-password:latest` (secret ref, not inline)
  - `ADMIN_TOKEN` → **Secret Manager** `feedback-admin-token:latest` (secret ref, not inline)

### `lifecycle.ignore_changes` on the service

```
template[0].containers[0].image   # CI swaps this
client                            # deploy-tool metadata, repopulated on every deploy
client_version                    # same
scaling                           # legacy/inert top-level scaling block; autoscaling is owned via template.scaling
```

Without ignoring `client`/`client_version`/`scaling`, `terraform plan` would
show perpetual drift after every CI deploy. With it, the plan is `No changes`
even right after a CI deploy, while TF still owns the meaningful skeleton.

---

## 5. GitHub Actions deploy pipeline

File: `.github/workflows/deploy-feedback-service.yml`

**Trigger:** push to `main` touching `feedback-service/**` or the workflow file;
also `workflow_dispatch`.

**Flow:**
1. Checkout
2. Auth to GCP via **Workload Identity Federation** (OIDC — no stored key)
3. Configure Docker for Artifact Registry
4. `docker build --platform linux/amd64` → push `:latest` + `:sha-<7>`
5. `gcloud run services update feedback-service --image=:sha-<7>` (image-only; TF owns the rest)
6. Print the service URL

### Required GitHub repo secrets (already set on `wudong/gcloud`)

| Secret | Value |
|---|---|
| `GCP_WIF_PROVIDER` | `projects/126174378735/locations/global/workloadIdentityPools/github-actions/providers/github` |
| `GCP_DEPLOYER_SA` | `github-actions-deployer@wudong-agent-master.iam.gserviceaccount.com` |

Re-print with `terraform output -raw github_wif_provider` / `… github_actions_deployer_email`.
Set with `gh secret set GCP_WIF_PROVIDER --repo wudong/gcloud --body "$VAL"`.

### Local/manual deploy (legacy)

`feedback-service/deploy.sh` still works but is now redundant — it re-passes
env/secrets inline, which TF already handles via secret refs. Prefer pushing to
`main` and letting CI run. If you use `deploy.sh`, expect a one-revision blip;
`terraform plan` stays clean because the image is ignored.

---

## 6. Workload Identity Federation (no long-lived keys)

File: `workload-identity.tf`

- `google_iam_workload_identity_pool.github` — pool `github-actions`
- `google_iam_workload_identity_pool_provider.github` — OIDC provider, issuer
  `https://token.actions.githubusercontent.com`, attribute-maps
  `assertion.repository` → `attribute.repository`, and an
  **attribute_condition restricting to `wudong/gcloud`** (change via
  `var.github_repo`).
- `google_service_account.github_actions` — `github-actions-deployer@…` (the SA
  GitHub Actions impersonates)
- Grants on that SA: `artifactregistry.writer`, `run.admin`, and
  `roles/iam.serviceAccountUser` on the runtime SA (so the deployed revision
  can run as `feedback-service-sa`).

**Never** create a JSON key for `github-actions-deployer`. The whole point of
WIF is short-lived OIDC tokens. To add another repo, add a second provider or
loosen the attribute condition.

---

## 7. Common operations

```bash
# Auth (one-time)
gcloud auth application-default login

# Plan / apply
terraform init
terraform plan
terraform apply

# After a CI deploy, confirm no drift:
terraform plan    # → No changes

# View outputs
terraform output
terraform output -raw feedback_service_url
terraform output -raw github_wif_provider

# Inspect the live service
gcloud run services describe feedback-service --region=us-central1 --project=wudong-agent-master

# Health check
curl -s -o /dev/null -w "%{http_code}\n" https://feedback-service-4nf5vq2ygq-uc.a.run.app/health

# List images in Artifact Registry
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/wudong-agent-master/feedback-service/feedback-service \
  --include-tags --project=wudong-agent-master

# Trigger a deploy manually without code change:
gh workflow run deploy-feedback-service.yml --repo wudong/gcloud
gh run watch --repo wudong/gcloud
```

---

## 8. Gotchas (read these before editing the Cloud Run / registry config)

1. **Memory < 512Mi requires `cpu_idle = true`.** Cloud Run v2 rejects
   `memory=256Mi` with "cpu always allocated" unless CPU is throttled
   (request-based). Keep `cpu_idle = true` in `resources` if you keep 256Mi;
   otherwise bump memory to ≥ 512Mi.

2. **Cloud SQL is via the `/cloudsql` unix socket, not TCP.** `feedback-service/src/db.ts`
   connects with `host: /cloudsql/${INSTANCE_CONNECTION_NAME}`. The TF config
   must keep both the `cloud_sql_instance` **volume** AND the
   `volume_mounts { mount_path = "/cloudsql" }`. Dropping the mount breaks the
   DB connection silently (revisions go unhealthy).

3. **Importing with the project NUMBER forces replacement.** Several GCP
   resources are `ForceNew` on `project`. When importing, use the project **ID**
   (`wudong-agent-master`), not the number, or `terraform plan` will want to
   destroy-and-recreate. We hit this on the Cloud Run service, its IAM, and both
   secrets and had to re-import with the project ID.

4. **Preserve the live `cloudsql.iam_authentication=on` DB flag.** The Cloud SQL
   instance has this flag set out-of-band; `main.tf` now declares it so apply
   doesn't remove it and break DB auth. If you remove it from TF, plan will try
   to clear it.

5. **Switching env secrets to Secret Manager refs must be value-equivalent.**
   When moving an env var from inline `value` to `value_source.secret_key_ref`,
   confirm the secret's `latest` version equals the currently-deployed inline
   value, or you'll change runtime behavior on next apply. We verified
   `feedback-db-password` and `feedback-admin-token` matched before applying.

6. **`terraform plan` shows drift on `client`/`client_version`/top-level
   `scaling` after every deploy.** These are deploy-tool metadata / a legacy
   inert scaling block. They're in `ignore_changes`. If you remove them from
   `ignore_changes`, expect perpetual non-empty plans (harmless but noisy).

7. **Artifact Registry storage free tier is 0.5 GB-month, aggregate across the
   billing account.** The cleanup policy (keep 3, delete untagged > 7d) exists
   to stay under it. Don't disable it unless you're watching the bill. Layer
   dedup means one small service rarely crosses 0.5 GB anyway.

8. **Cloud Run can't pull private external registries directly.** It natively
   authenticates only to Artifact Registry / gcr.io / Docker Hub (public). For a
   *private* GHCR/Artifactory/ECR image you must front it with an **Artifact
   Registry remote repository** (which holds the upstream credential) and deploy
   from the remote-repo URL. Public external images (e.g. `ghcr.io/…` public)
   pull anonymously. We chose **private Artifact Registry** to avoid any of
   this — no PAT, no rotation, native Cloud Run pull.

9. **Secret values never go in `.tf`/`tfvars`** (they'd land in `terraform.tfstate`
   in plaintext). Manage only the secret *container* in TF; set values with
   `gcloud secrets versions add`.

10. **`terraform.tfvars` is gitignored** (billing account). When cloning fresh,
    recreate it from `terraform.tfvars`'s template and set `billing_account`
    and `github_repo`.

---

## 9. Free-tier posture

- VM `e2-micro` (Always Free in us-central1/us-east1/us-west1)
- Cloud Storage 5 GB US multi-region
- Cloud SQL `db-f1-micro` Postgres, 10 GB
- Cloud Run: 2M requests/month free
- Artifact Registry: 0.5 GB-month free (enforced by cleanup policy)
- Secret Manager: 6 active versions/month free — **currently exceeded** (~14 secrets) → small charge
- Cloud Build: not used (we use GitHub Actions, 2000 min/month free for private repos)
- Cloudflare DNS (free) for `wudong-agent-master.graceliu.uk`

---

## 10. Pointers for agents

- Before changing `feedback-service.tf`, re-read §4 and §8 (gotchas 1, 2, 6).
- After any `terraform import`, run `terraform plan` and check for
  `forces replacement` — that's the project-number-vs-ID smell (gotcha 3).
- After any change to the Cloud Run service, confirm the new revision is
  `Ready` and `/health` returns 200 before declaring done.
- Don't commit `terraform.tfstate`, `*.tfstate.*.backup`, or `terraform.tfvars`
  (all gitignored).
- The deploy pipeline is image-only; if a change needs new env/secrets/scaling,
  do it in Terraform (`terraform apply`), not in the workflow.