#!/bin/bash
# =============================================================================
# Deploy Feedback Service to Cloud Run (IAM auth — no DB password needed)
# =============================================================================
set -euo pipefail

PROJECT="wudong-agent-master"
REGION="us-central1"
SERVICE_NAME="feedback-service"
IMAGE="us-central1-docker.pkg.dev/${PROJECT}/feedback-service/feedback-service:latest"
INSTANCE="wudong-agent-master:us-central1:wd-agents-pg"
SA="feedback-service-sa@${PROJECT}.iam.gserviceaccount.com"

echo "=== Deploying Feedback Service to Cloud Run ==="

# 1. Get secrets
DB_PASS=$(gcloud secrets versions access latest --secret=feedback-db-password --project="${PROJECT}" 2>/dev/null)
ADMIN_TOKEN=$(gcloud secrets versions access latest --secret=feedback-admin-token --project="${PROJECT}" 2>/dev/null)

# 2. Build & push (linux/amd64 for Cloud Run)
echo "--- Building & pushing Docker image (linux/amd64) ---"
docker build --platform linux/amd64 -t "${IMAGE}" .
docker push "${IMAGE}"

# 3. Deploy with IAM auth
echo "--- Deploying to Cloud Run ---"
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --platform=managed \
  --allow-unauthenticated \
  --service-account="${SA}" \
  --memory=256Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=5 \
  --concurrency=80 \
  --timeout=30s \
  --set-env-vars="INSTANCE_CONNECTION_NAME=${INSTANCE}" \
  --set-env-vars="DB_USER=feedback-service" \
  --set-env-vars="DB_PASS=${DB_PASS}" \
  --set-env-vars="DB_NAME=app-db" \
  --set-env-vars="ADMIN_TOKEN=${ADMIN_TOKEN}" \
  --add-cloudsql-instances="${INSTANCE}" \
  --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT}" --region="${REGION}" --format='value(status.url)' 2>/dev/null)

echo ""
echo "============================================"
echo "  Feedback Service Deployed!"
echo "  URL:    ${SERVICE_URL}"
echo "  Admin:  ${SERVICE_URL}/admin"
echo "  Auth:   IAM (no DB password)"
echo "============================================"
