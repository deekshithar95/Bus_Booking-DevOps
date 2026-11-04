#!/usr/bin/env bash
set -euo pipefail
: "${ECR_REGISTRY:?Set ECR_REGISTRY}"
: "${USER_IMAGE_TAG:?Set USER_IMAGE_TAG to the previous known-good tag}"
: "${BUS_IMAGE_TAG:?Set BUS_IMAGE_TAG to the previous known-good tag}"
: "${BOOKING_IMAGE_TAG:?Set BOOKING_IMAGE_TAG to the previous known-good tag}"
: "${AWS_REGION:?Set AWS_REGION}"

aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker compose --env-file .env -f compose.prod.yaml pull
docker compose --env-file .env -f compose.prod.yaml up -d
docker compose --env-file .env -f compose.prod.yaml ps
