# =============================================================================
# Outputs — Key resource identifiers and connection info
# =============================================================================

output "project_id" {
  description = "GCP Project ID"
  value       = google_project.main.project_id
}

output "project_number" {
  description = "GCP Project Number"
  value       = google_project.main.number
}

# VM
output "vm_name" {
  description = "Name of the Compute Engine VM"
  value       = google_compute_instance.main_vm.name
}

output "vm_external_ip" {
  description = "Static external IP address of the VM"
  value       = google_compute_address.vm_static_ip.address
}

output "vm_zone" {
  description = "Zone where the VM is deployed"
  value       = google_compute_instance.main_vm.zone
}

# Storage
output "bucket_name" {
  description = "Name of the Cloud Storage bucket"
  value       = google_storage_bucket.main.name
}

output "bucket_url" {
  description = "URL of the Cloud Storage bucket"
  value       = google_storage_bucket.main.url
}

# Secret Manager
output "db_password_secret_id" {
  description = "Full path to the DB password secret in Secret Manager"
  value       = google_secret_manager_secret.db_password.id
}

output "db_password" {
  description = "⚠️  The auto-generated DB password (sensitive)"
  value       = random_password.db_password.result
  sensitive   = true
}

# Cloud SQL
output "db_instance_name" {
  description = "Cloud SQL instance name"
  value       = google_sql_database_instance.main.name
}

output "db_connection_name" {
  description = "Cloud SQL instance connection name (for private IP)"
  value       = google_sql_database_instance.main.connection_name
}

output "db_instance_ip" {
  description = "Cloud SQL instance public IP address"
  value       = google_sql_database_instance.main.public_ip_address
}

output "db_name" {
  description = "PostgreSQL database name"
  value       = google_sql_database.main.name
}

output "db_user" {
  description = "PostgreSQL username"
  value       = google_sql_user.main.name
}

# SSH command
output "ssh_command" {
  description = "Command to SSH into the VM"
  value       = "gcloud compute ssh ${google_compute_instance.main_vm.name} --project ${google_project.main.project_id} --zone ${google_compute_instance.main_vm.zone}"
}
