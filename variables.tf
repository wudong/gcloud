# GCP Project

variable "project_id" {
  description = "GCP project ID (must be globally unique)"
  type        = string
  default     = "wd-agents"
}

variable "project_name" {
  description = "Human-readable GCP project name"
  type        = string
  default     = "WD Agents"
}

variable "billing_account" {
  description = "GCP billing account ID (e.g., 01ABCD-234EFG-567HIJ). Required to link billing to the project."
  type        = string
}

variable "folder_id" {
  description = "GCP folder ID to create the project under (optional). Set to empty string to create under the organization root."
  type        = string
  default     = ""
}

variable "org_id" {
  description = "GCP organization ID to create the project under (optional)"
  type        = string
  default     = ""
}

# Region & Zone

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone for the VM instance"
  type        = string
  default     = "us-central1-a"
}

# Compute Engine VM

variable "vm_name" {
  description = "Name of the Compute Engine VM instance"
  type        = string
  default     = "main-vm"
}

variable "vm_machine_type" {
  description = "Machine type for the VM (Always Free: e2-micro)"
  type        = string
  default     = "e2-micro"
}

variable "vm_image_family" {
  description = "OS image family for the VM"
  type        = string
  default     = "debian-12"
}

# Cloud Storage

variable "bucket_name" {
  description = "Globally unique name for the Cloud Storage bucket"
  type        = string
  default     = "wd-agents-storage-bucket"
}

variable "bucket_location" {
  description = "Storage bucket location (US multi-region for Always Free tier)"
  type        = string
  default     = "US"
}

# Cloud SQL (PostgreSQL)

variable "db_instance_name" {
  description = "Name of the Cloud SQL PostgreSQL instance"
  type        = string
  default     = "wd-agents-pg"
}

variable "db_name" {
  description = "Name of the PostgreSQL database"
  type        = string
  default     = "app-db"
}

variable "db_user" {
  description = "PostgreSQL username"
  type        = string
  default     = "app-user"
}

variable "db_password_length" {
  description = "Length of the auto-generated database password"
  type        = number
  default     = 16
}

# GitHub Actions (Workload Identity Federation)

variable "github_repo" {
  description = "GitHub repository allowed to impersonate the deployer SA via Workload Identity Federation, in the form 'owner/name' (e.g. 'wudong/gcloud'). Leave empty to disable GitHub Actions deploys."
  type        = string
  default     = ""
}
