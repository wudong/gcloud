# =============================================================================
# Feedback Service — Cloud Run + Artifact Registry + Secret Manager wiring
#
# Terraform owns the service *skeleton*: region, ingress, auth, scaling, env,
# secret mounts, Cloud SQL connection, runtime service account, and IAM.
#
# The *image* is deliberately ignored (lifecycle.ignore_changes) so you can
# build/push/deploy images freely (manually or via GitHub Actions) without
# Terraform fighting you. A deploy is just:
#   gcloud run services update feedback-service --image=... --region=us-central1
# =============================================================================

# -----------------------------------------------------------------------------
# APIs
# -----------------------------------------------------------------------------
resource "google_project_service" "run" {
  project            = google_project.main.project_id
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  project            = google_project.main.project_id
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# -----------------------------------------------------------------------------
# Artifact Registry — Docker repo for the feedback-service image
# Includes a cleanup policy to auto-prune old images and stay under the
# 0.5 GB free tier (keep latest 3 tagged versions, delete untagged > 7 days).
# -----------------------------------------------------------------------------
resource "google_artifact_registry_repository" "feedback_service" {
  project       = google_project.main.project_id
  location      = var.region
  repository_id = "feedback-service"
  format        = "DOCKER"
  description   = "Container images for the feedback-service Cloud Run app"

  cleanup_policy_dry_run = false

  # Keep the 3 most recent tagged versions
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  # Delete dangling/untagged images older than 7 days
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "7d"
    }
  }

  depends_on = [google_project_service.artifactregistry]
}

# -----------------------------------------------------------------------------
# Runtime service account for the Cloud Run revision
# (created manually outside Terraform originally — imported into state)
# -----------------------------------------------------------------------------
resource "google_service_account" "feedback_service" {
  project      = google_project.main.project_id
  account_id   = "feedback-service-sa"
  display_name = "Feedback Service (Cloud Run runtime)"
  description  = "Runtime identity for the feedback-service Cloud Run service"
}

# Least-privilege roles for the runtime SA.
# (These are additive google_project_iam_member bindings; existing broader
#  grants such as editor/owner on this SA are left untouched.)
resource "google_project_iam_member" "feedback_sa_cloudsql_client" {
  project = google_project.main.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.feedback_service.email}"
}

resource "google_project_iam_member" "feedback_sa_cloudsql_instanceuser" {
  project = google_project.main.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.feedback_service.email}"
}

resource "google_project_iam_member" "feedback_sa_secret_accessor" {
  project = google_project.main.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.feedback_service.email}"
}

# -----------------------------------------------------------------------------
# Secrets — imported (created manually outside Terraform originally).
# Only the *secret container* is managed here; the secret *values/versions*
# are intentionally NOT managed by Terraform (you set them out-of-band).
# -----------------------------------------------------------------------------
resource "google_secret_manager_secret" "feedback_db_password" {
  project   = google_project.main.project_id
  secret_id = "feedback-db-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret" "feedback_admin_token" {
  project   = google_project.main.project_id
  secret_id = "feedback-admin-token"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

# Secret-level IAM (explicit; also granted project-wide above, this is harmless)
resource "google_secret_manager_secret_iam_member" "feedback_db_password_sa" {
  secret_id = google_secret_manager_secret.feedback_db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.feedback_service.email}"
}

resource "google_secret_manager_secret_iam_member" "feedback_admin_token_sa" {
  secret_id = google_secret_manager_secret.feedback_admin_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.feedback_service.email}"
}

# -----------------------------------------------------------------------------
# Cloud Run service (skeleton). Image is ignored after creation so deploys
# can swap the image without Terraform drift.
# -----------------------------------------------------------------------------
locals {
  feedback_service_image = "${google_artifact_registry_repository.feedback_service.location}-docker.pkg.dev/${google_project.main.project_id}/feedback-service/feedback-service:latest"
}

resource "google_cloud_run_v2_service" "feedback_service" {
  project  = google_project.main.project_id
  name     = "feedback-service"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.feedback_service.email
    timeout         = "30s"
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    # Cloud SQL (Postgres) connection — v2 models this as a cloud_sql volume
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = local.feedback_service_image
      name  = "feedback-service"

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        # CPU only during request processing (request-based billing) — allows memory < 512Mi.
        cpu_idle = true
      }

      # Mount the Cloud SQL unix socket the app connects to (host: /cloudsql/<conn>)
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "INSTANCE_CONNECTION_NAME"
        value = google_sql_database_instance.main.connection_name
      }
      env {
        name  = "DB_USER"
        value = "feedback-service"
      }
      env {
        name  = "DB_NAME"
        value = google_sql_database.main.name
      }
      env {
        name = "DB_PASS"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.feedback_db_password.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "ADMIN_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.feedback_admin_token.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
      scaling,
    ]
  }

  depends_on = [
    google_project_service.run,
    google_project_service.artifactregistry,
    google_secret_manager_secret.feedback_db_password,
    google_secret_manager_secret.feedback_admin_token,
  ]
}

# Public (unauthenticated) access — matches `--allow-unauthenticated`.
resource "google_cloud_run_v2_service_iam_member" "feedback_invoker" {
  project    = google_project.main.project_id
  location   = google_cloud_run_v2_service.feedback_service.location
  name       = google_cloud_run_v2_service.feedback_service.name
  role       = "roles/run.invoker"
  member     = "allUsers"
}