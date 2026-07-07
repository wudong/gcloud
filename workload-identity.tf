# =============================================================================
# Workload Identity Federation for GitHub Actions
#
# Lets GitHub Actions authenticate to GCP using short-lived OIDC tokens —
# NO long-lived service-account JSON key stored in the repo.
#
# GitHub Actions impersonates `github-actions-deployer@...` (created below),
# which has rights to push images to Artifact Registry and deploy to Cloud Run
# (as the runtime SA `feedback-service-sa`).
#
# Configure the allowed repo in terraform.tfvars:  github_repo = "owner/name"
# =============================================================================

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "OIDC pool for GitHub Actions deployments"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions OIDC"
  description                        = "GitHub-hosted Actions via token.actions.githubusercontent.com"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # Restrict to a single repository (set var.github_repo, e.g. "wudong/gcloud")
  attribute_condition = "attribute.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# -----------------------------------------------------------------------------
# Deployer SA — impersonated by GitHub Actions via WIF
# -----------------------------------------------------------------------------
resource "google_service_account" "github_actions" {
  project      = google_project.main.project_id
  account_id   = "github-actions-deployer"
  display_name = "GitHub Actions deployer"
  description  = "Impersonated by GitHub Actions via WIF to push images and deploy feedback-service"
}

# Allow the WIF pool (restricted to var.github_repo) to act as this SA
resource "google_service_account_iam_member" "github_actions_wif" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# Push images to Artifact Registry
resource "google_project_iam_member" "github_actions_ar_writer" {
  project = google_project.main.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Deploy / update Cloud Run services
resource "google_project_iam_member" "github_actions_run_admin" {
  project = google_project.main.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Act as the runtime SA so the deployed revision runs as feedback-service-sa
resource "google_service_account_iam_member" "github_actions_sa_user" {
  service_account_id = google_service_account.feedback_service.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_actions.email}"
}