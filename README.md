# BusBooking – AWS DevOps CI/CD Project

A DevOps-focused deployment of three existing-style Node.js microservices:
- User Service (`3001`)
- Bus Service (`3002`)
- Booking Service (`3003`)

The repository demonstrates GitHub workflow, Docker, Docker Compose, Nginx, Jenkins, Terraform, Amazon ECR, EC2, Prometheus and Grafana.

> Scope note: the supplied assignment says application feature development is out of scope. The included services are minimal runnable health-check/API scaffolds so the infrastructure can be tested. Integrate your actual BusBooking business logic into these service folders without changing the deployment contracts.

## Architecture

GitHub → Jenkins → test/build/Trivy scan → Amazon ECR → SSH deployment to Ubuntu EC2 → Docker Compose → Nginx → services.
Prometheus scrapes Node Exporter and the services; Grafana visualizes the metrics.

## Repository structure

```text
BusBooking-DevOps/
├── services/
│   ├── user-service/
│   ├── bus-service/
│   └── booking-service/
├── database/
│   └── init.sql
├── nginx/
│   └── default.conf
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/provisioning/datasources/prometheus.yml
├── terraform/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
├── scripts/
│   ├── deploy-remote.sh
│   └── rollback.sh
├── compose.yaml
├── compose.prod.yaml
├── Jenkinsfile
└── .env.example
```

## Prerequisites

- Git and GitHub repository
- Docker Engine and Docker Compose plugin
- Node.js 22+ (only needed for local non-container development)
- Jenkins with Pipeline, Git and Credentials plugins
- Jenkins agent with Docker, AWS CLI, Trivy and SSH client installed
- AWS account, AWS CLI credentials for Terraform/Jenkins, and an EC2 key pair if SSH access is required
- Terraform 1.5+
- A Linux/Ubuntu EC2 instance for deployment

## 1. Configure environment

```bash
cp .env.example .env
```

Set strong values for `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` and `JWT_SECRET`. Never commit `.env`, AWS keys, private keys, or Terraform state.

## 2. Run locally

```bash
docker compose up -d --build
docker compose ps
```

Check:
- `http://localhost/` – Nginx landing response
- `http://localhost/api/users/health`
- `http://localhost/api/buses/health`
- `http://localhost/api/bookings/health`

The database is exposed on host port `3307` for local development. MySQL data is stored in the `mysql_data` volume.

View logs:

```bash
docker compose logs -f user-service
docker compose logs -f bus-service
docker compose logs -f booking-service
```

Stop:

```bash
docker compose down
```

Remove local database data only when intentionally resetting:

```bash
docker compose down -v
```

## 3. Git workflow

Recommended branches:
- `main`: deployable release branch
- `develop`: integration branch
- `feature/<name>`: individual changes
- `hotfix/<name>`: urgent production fixes

Create a feature branch, commit changes, push it, and open a pull request to `develop`. Promote tested changes to `main`. Configure a GitHub webhook to trigger the Jenkins Pipeline on push or pull request. Protect `main` with pull-request review and status checks.

## 4. AWS infrastructure with Terraform

From the `terraform/` directory:

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit region, instance type, SSH CIDR and public key name as needed.
aws configure
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
terraform output
```

Terraform provisions:
- One Ubuntu EC2 instance
- Three ECR repositories: user, bus and booking
- Security group
- IAM role, instance profile and least-privilege ECR pull permissions

The EC2 instance role is used for ECR pulls. Restrict `admin_cidr` to your public IP with `/32`. Port 80 is public for the sample app. SSH port 22 is restricted to the configured CIDR. Do not expose Jenkins, Prometheus or Grafana publicly.

Terraform state may contain sensitive infrastructure metadata. Keep it out of Git and use a secured remote backend for team/production use.

## 5. Jenkins configuration

Create a Jenkins Pipeline job pointing to this repository and configure:
- GitHub webhook: `https://<jenkins-host>/github-webhook/`
- String credential `aws-region` is not required; region is a Jenkins parameter.
- AWS credentials ID: `aws-credentials` (IAM user/role permissions for ECR push)
- SSH private key credential ID: `busbooking-ec2-ssh`
- Jenkins agent tools: Docker, AWS CLI, Trivy and SSH

Set the Jenkins job parameters:
- `AWS_REGION`
- `ECR_REGISTRY` (account ID + `.dkr.ecr.<region>.amazonaws.com`)
- `EC2_HOST` (Terraform output `ec2_public_ip`)
- `SSH_USER` (default `ubuntu`)

Pipeline stages:
1. Checkout
2. Validate Compose and service manifests
3. Run available service tests
4. Build images with commit/build tags
5. Scan images with Trivy
6. Authenticate and push images to ECR
7. Deploy selected image tags to EC2
8. Verify service health through Nginx

For the Jenkins agent, ensure Docker commands are permitted. Prefer an instance role on an AWS-hosted Jenkins agent over long-lived access keys.

## 6. Deploy on EC2

Terraform's user-data installs Docker Engine and the Compose plugin. Copy this repository to EC2 or let Jenkins transfer it. The deployment script pulls the selected ECR image tags and runs `compose.prod.yaml`.

Manual deployment example:

```bash
export ECR_REGISTRY="<account>.dkr.ecr.<region>.amazonaws.com"
export AWS_REGION="ap-south-1"
export USER_IMAGE_TAG="<git-sha>"
export BUS_IMAGE_TAG="<git-sha>"
export BOOKING_IMAGE_TAG="<git-sha>"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
```

## 7. Monitoring

The production Compose file includes Prometheus, Node Exporter and Grafana. Keep ports `9090` and `3000` private; use an SSH tunnel or VPN for administration.

- Prometheus: `http://<EC2-private-or-tunnel-host>:9090`
- Grafana: `http://<EC2-private-or-tunnel-host>:3000`
- Node Exporter: internal port `9100`

Grafana datasource provisioning points to Prometheus. Build dashboards for CPU, memory, filesystem, container/service availability and application metrics. The starter services expose health endpoints for Docker/Nginx/deployment checks. Prometheus scrapes Node Exporter and itself; add Prometheus client instrumentation and configure scrape endpoints if application-level metrics are required.

## 8. Rollback

Keep the previous known-good image tags. To roll back, set the three image tag variables to the previous release and run:

```bash
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
docker compose -f compose.prod.yaml ps
```

`scripts/rollback.sh` is a helper for a host where the production Compose file and Docker environment are already configured.

## 9. Troubleshooting checklist

```bash
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs --tail=100
docker inspect <container-name>
df -h
free -h
top
sudo journalctl -u docker --since "30 minutes ago"
```

Common checks:
- ECR `AccessDenied`: verify EC2 instance profile and ECR pull permissions.
- Jenkins push denied: verify Jenkins AWS credential policy includes ECR login and image push actions.
- Nginx `502`: verify upstream container names, ports, health and shared Docker network.
- MySQL connection failure: verify DB hostname is `mysql` inside Compose, credentials match, and database initialization completed.
- SSH failure: verify `admin_cidr`, key pair and `ubuntu` username.
- Container exits: inspect logs and environment variables; do not print secrets in logs.

## 10. Cleanup

After collecting evidence and screenshots:

```bash
cd terraform
terraform destroy
```

Also remove any ECR images/repositories left behind if Terraform deletion is blocked by non-empty repositories. Confirm AWS billing and budget alerts before leaving resources running.

## Evidence checklist for assessment

1. GitHub repository and branch/PR workflow
2. `docker compose ps` showing all containers healthy
3. Nginx route checks for all three services
4. Jenkins successful pipeline stages
5. Trivy scan output
6. Terraform plan/apply and outputs
7. Three ECR repositories with versioned images
8. EC2 instance and security group
9. Prometheus targets showing exporters/services
10. Grafana dashboard
11. Simulated service failure, logs, root cause and recovery
12. Rollback demonstration and Terraform cleanup

## Four-day execution plan

| Day | Work |
|---|---|
| 1 | Repository review, Git workflow, EC2 preparation, Dockerfiles, Compose, Nginx |
| 2 | Terraform, ECR, IAM, Jenkins integration and image publishing |
| 3 | EC2 deployment, health verification, rollback and release evidence |
| 4 | Prometheus, Node Exporter, Grafana, failure simulation, documentation and cleanup |
