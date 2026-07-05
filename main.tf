# =============================================================================
# WD Agents — GCP Infrastructure (Terraform)
# All resources are Always Free tier eligible where possible.
# =============================================================================

# -----------------------------------------------------------------------------
# Providers
# -----------------------------------------------------------------------------
terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

# Bootstrap provider — used only to create the project (no project set)
provider "google" {
  alias   = "bootstrap"
  region  = var.region
  zone    = var.zone
}

# Main provider — uses the newly created project for all resources
provider "google" {
  project = google_project.main.project_id
  region  = var.region
  zone    = var.zone
}

# -----------------------------------------------------------------------------
# GCP Project
# -----------------------------------------------------------------------------
resource "google_project" "main" {
  provider = google.bootstrap

  name            = var.project_name
  project_id      = var.project_id
  billing_account = var.billing_account
}

# -----------------------------------------------------------------------------
# Required APIs
# -----------------------------------------------------------------------------
resource "google_project_service" "compute" {
  project            = google_project.main.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "storage" {
  project            = google_project.main.project_id
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  project            = google_project.main.project_id
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "sqladmin" {
  project            = google_project.main.project_id
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "servicenetworking" {
  project            = google_project.main.project_id
  service            = "servicenetworking.googleapis.com"
  disable_on_destroy = false
}

# Locals to group API dependencies for cleaner depends_on references
locals {
  all_apis = [
    google_project_service.compute,
    google_project_service.storage,
    google_project_service.secretmanager,
    google_project_service.sqladmin,
    google_project_service.servicenetworking,
  ]
}

# -----------------------------------------------------------------------------
# VPC Network
# -----------------------------------------------------------------------------
resource "google_compute_network" "main" {
  project = google_project.main.project_id
  name    = "main-network"

  auto_create_subnetworks = true

  depends_on = [google_project_service.compute]
}

# -----------------------------------------------------------------------------
# Firewall Rules
# -----------------------------------------------------------------------------
resource "google_compute_firewall" "allow_ssh" {
  project = google_project.main.project_id
  name    = "allow-ssh"
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["ssh-enabled"]

  depends_on = [google_project_service.compute]
}

resource "google_compute_firewall" "allow_http" {
  project = google_project.main.project_id
  name    = "allow-http"
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web-server"]

  depends_on = [google_project_service.compute]
}

resource "google_compute_firewall" "allow_https" {
  project = google_project.main.project_id
  name    = "allow-https"
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web-server"]

  depends_on = [google_project_service.compute]
}

# -----------------------------------------------------------------------------
# Static External IP for VM
# -----------------------------------------------------------------------------
resource "google_compute_address" "vm_static_ip" {
  project = google_project.main.project_id
  name    = "${var.vm_name}-static-ip"
  region  = var.region

  depends_on = [google_project_service.compute]
}

# -----------------------------------------------------------------------------
# Secret Manager — DB Password
# -----------------------------------------------------------------------------
resource "random_password" "db_password" {
  length           = var.db_password_length
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "google_secret_manager_secret" "db_password" {
  project   = google_project.main.project_id
  secret_id = "db-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result

  depends_on = [google_project_service.secretmanager]
}

# IAM: Allow project owners to read the secret
resource "google_secret_manager_secret_iam_member" "db_password_viewer" {
  project   = google_project.main.project_id
  secret_id = google_secret_manager_secret.db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "user:wudong.liu@gmail.com"

  depends_on = [google_project_service.secretmanager]
}

# -----------------------------------------------------------------------------
# Compute Engine VM — e2-micro (Always Free)
# -----------------------------------------------------------------------------
resource "google_compute_instance" "main_vm" {
  project      = google_project.main.project_id
  name         = var.vm_name
  machine_type = var.vm_machine_type
  zone         = var.zone

  tags = ["ssh-enabled", "web-server"]

  boot_disk {
    initialize_params {
      image = "projects/debian-cloud/global/images/family/${var.vm_image_family}"
      size  = 30
      type  = "pd-standard"
    }
  }

  network_interface {
    network = google_compute_network.main.name
    access_config {
      nat_ip = google_compute_address.vm_static_ip.address
    }
  }

  metadata = {
    startup-script = <<-EOT
      #!/bin/bash
      apt-get update
      apt-get install -y curl git htop
      echo "VM provisioned successfully at $(date)" > /etc/provisioned
    EOT
  }

  depends_on = [
    google_project_service.compute,
    google_compute_firewall.allow_ssh,
    google_compute_firewall.allow_http,
    google_compute_firewall.allow_https,
  ]
}

# -----------------------------------------------------------------------------
# Cloud Storage Bucket (Always Free: 5 GB US multi-region)
# -----------------------------------------------------------------------------
resource "google_storage_bucket" "main" {
  project       = google_project.main.project_id
  name          = var.bucket_name
  location      = var.bucket_location
  force_destroy = true

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  autoclass {
    enabled = false
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.storage]
}

# Allow project editors to read objects in the bucket
resource "google_storage_bucket_iam_binding" "viewer" {
  bucket = google_storage_bucket.main.name
  role   = "roles/storage.objectViewer"
  members = [
    "projectEditor:${google_project.main.project_id}",
  ]
}

# -----------------------------------------------------------------------------
# Service Networking (required for Cloud SQL)
# -----------------------------------------------------------------------------
resource "google_compute_global_address" "service_networking" {
  project       = google_project.main.project_id
  name          = "service-networking-address"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id

  depends_on = [
    google_project_service.compute,
    google_project_service.servicenetworking,
  ]
}

resource "google_service_networking_connection" "vpc_peering" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.service_networking.name]

  depends_on = [google_project_service.servicenetworking]
}

# -----------------------------------------------------------------------------
# Cloud SQL — PostgreSQL db-f1-micro (Always Free)
# -----------------------------------------------------------------------------
resource "google_sql_database_instance" "main" {
  project             = google_project.main.project_id
  name                = var.db_instance_name
  database_version    = "POSTGRES_15"
  region              = var.region
  deletion_protection = false

  settings {
    tier                            = "db-f1-micro"
    disk_size                       = 10
    disk_type                       = "PD_SSD"
    disk_autoresize                 = true
    disk_autoresize_limit           = 20
    activation_policy               = "ALWAYS"
    availability_type               = "ZONAL"
    backup_configuration {
      enabled                      = true
      binary_log_enabled           = false
      start_time                   = "02:00"
      transaction_log_retention_days = 7
    }
    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }
  }

  depends_on = [
    google_project_service.sqladmin,
    google_service_networking_connection.vpc_peering,
  ]
}

resource "google_sql_database" "main" {
  project  = google_project.main.project_id
  name     = var.db_name
  instance = google_sql_database_instance.main.name

  depends_on = [google_project_service.sqladmin]
}

resource "google_sql_user" "main" {
  project  = google_project.main.project_id
  name     = var.db_user
  instance = google_sql_database_instance.main.name
  password = random_password.db_password.result

  depends_on = [google_project_service.sqladmin]
}
