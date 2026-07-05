# WD Agents — GCP Infrastructure

Terraform configuration to provision a GCP project with Always Free tier resources.

## Resources Created

| Resource | Details | Free Tier |
|---|---|---|
| **GCP Project** | `wudong-agent-master` | — |
| **Compute Engine VM** | `e2-micro` (2 vCPU, 1 GB RAM), Debian 12 | ✅ Always Free (us-central1) |
| **Cloud Storage** | 5 GB, US multi-region, versioning enabled | ✅ Always Free |
| **Secret Manager** | DB password (auto-generated), Cloudflare DNS API key | ✅ Always Free (6 secret versions) |
| **Cloud SQL** | PostgreSQL 15, `db-f1-micro` (shared CPU) | ✅ Always Free |
| **VPC Network** | Default network + firewall (SSH, HTTP, HTTPS) | ✅ Always Free |

## Prerequisites

1. **Google Cloud CLI** (`gcloud`) — [Install guide](https://cloud.google.com/sdk/docs/install)
2. **Terraform** >= 1.0 — [Install guide](https://developer.hashicorp.com/terraform/downloads)
3. **GCP Billing Account** — you need an active billing account linked
4. **GCP Authentication** — run:
   ```bash
   gcloud auth application-default login
   ```

## Setup

### 1. Configure your billing account

Edit `terraform.tfvars` and replace `REPLACE_WITH_YOUR_BILLING_ACCOUNT_ID`:

```bash
# Find your billing account ID
gcloud billing accounts list
```

### 2. Initialize Terraform

```bash
terraform init
```

### 3. Review the plan

```bash
terraform plan
```

This will show ~20 resources to create (project, APIs, network, VM, storage, secrets, SQL).

### 4. Apply

```bash
terraform apply
```

Type `yes` to confirm. First apply may take 5–10 minutes (API enablement + Cloud SQL provisioning).

## Connecting to Resources

### SSH into the VM

```bash
gcloud compute ssh main-vm --project wudong-agent-master --zone us-central1-a
```

Or use the output directly:
```bash
terraform output -raw ssh_command | bash
```

### Access the Storage Bucket

```bash
# List bucket
gsutil ls gs://wd-agents-storage-bucket/

# Upload a file
echo "hello" > test.txt && gsutil cp test.txt gs://wd-agents-storage-bucket/

# Download a file
gsutil cp gs://wd-agents-storage-bucket/test.txt .
```

### View the DB Password

```bash
# From Secret Manager
gcloud secrets versions access latest --secret="db-password" --project="wudong-agent-master"

# Or from Terraform output (won't show in terminal — stored in state)
terraform output -raw db_password
```

### Cloudflare DNS API Key

```bash
# Read the key
gcloud secrets versions access latest --secret="cloudflare-dns-key" --project="wudong-agent-master"

# Use with Cloudflare API
export CLOUDFLARE_API_TOKEN=$(gcloud secrets versions access latest --secret="cloudflare-dns-key" --project="wudong-agent-master")
curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify
```

### Connect to PostgreSQL

```bash
# Install Cloud SQL Auth Proxy
gcloud components install cloud_sql_proxy

# Start the proxy
cloud_sql_proxy -instances="wudong-agent-master:us-central1:wd-agents-pg"=tcp:5432 &

# Connect with psql
psql "host=127.0.0.1 port=5432 user=app-user dbname=app-db sslmode=disable"
```

### Connect to PostgreSQL directly (via public IP)

```bash
# Get the public IP
terraform output -raw db_instance_ip

# Connect (only works if your IP is in authorized networks)
psql -h <IP_ADDRESS> -U app-user -d app-db
```

## Teardown

To destroy all resources:
```bash
terraform destroy
```

## Free Tier Notes

- **VM**: `e2-micro` is free only in `us-central1`, `us-east1`, and `us-west1`. Do NOT change the region unless you accept VM charges.
- **Storage**: First 5 GB per month is free. The lifecycle rule auto-deletes objects older than 90 days.
- **Secret Manager**: Up to 6 active secret versions are free.
- **Cloud SQL**: `db-f1-micro` with 10 GB storage is free. Disk autoresize limit is capped at 20 GB to stay near free limits.
- **Network**: VPC networks, firewall rules, and static IPs are always free.

## Project Structure

```
├── main.tf              # All GCP resources
├── variables.tf        # Variable declarations
├── outputs.tf          # Output values
├── terraform.tfvars    # Your configuration (do not commit)
├── backend.tf          # State backend (local)
├── .gitignore          # Files to ignore
└── README.md           # This file
```
