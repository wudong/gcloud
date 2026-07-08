# Remote state backend — Google Cloud Storage.
#
# The bucket `wudong-agent-master-tfstate` is created and managed OUT-OF-BAND
# (with gcloud), deliberately NOT by this Terraform config, so that the state
# bucket is not self-referential (you can't lose the state that manages the
# bucket that holds the state). It is hardened: uniform bucket-level access,
# object versioning (rollback), public-access-prevention enforced, and IAM
# limited to the owner only — because terraform.tfstate contains plaintext
# secrets (DB password, etc.).
#
# Recreate the bucket if needed:
#   gcloud storage buckets create gs://wudong-agent-master-tfstate \
#     --project=wudong-agent-master --location=us-central1 \
#     --uniform-bucket-level-access
#   gsutil versioning set on gs://wudong-agent-master-tfstate
#   gcloud storage buckets update gs://wudong-agent-master-tfstate --public-access-prevention
#   gcloud storage buckets add-iam-policy-binding gs://wudong-agent-master-tfstate \
#     --member=user:wudong.liu@gmail.com --role=roles/storage.objectAdmin
terraform {
  backend "gcs" {
    bucket = "wudong-agent-master-tfstate"
    prefix = "gcloud"
  }
}