# Local state backend
# For production, consider using Cloud Storage or Terraform Cloud for remote state
terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}
