pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    parameters {
        string(name: 'AWS_REGION', defaultValue: 'ap-south-1', description: 'AWS deployment region')
        string(name: 'ECR_REGISTRY', defaultValue: '', description: '123456789012.dkr.ecr.ap-south-1.amazonaws.com')
        string(name: 'EC2_HOST', defaultValue: '', description: 'Terraform output ec2_public_ip')
        string(name: 'SSH_USER', defaultValue: 'ubuntu', description: 'Ubuntu EC2 username')
    }

    environment {
        AWS_CREDS = 'aws-credentials'
        SSH_CREDS = 'busbooking-ec2-ssh'
        IMAGE_TAG = "${env.GIT_COMMIT ? env.GIT_COMMIT.take(7) : env.BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Validate') {
            steps {
                sh '''
                  set -eu
                  docker compose -f compose.yaml config --quiet
                  for service in user-service bus-service booking-service; do
                    test -f "services/$service/Dockerfile"
                    test -f "services/$service/package.json"
                    node --check "services/$service/src/server.js"
                  done
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                  set -eu
                  for service in user-service bus-service booking-service; do
                    (cd "services/$service" && npm install --package-lock=false && npm test)
                  done
                '''
            }
        }

        stage('Build and Scan') {
            steps {
                sh '''
                  set -eu
                  for service in user bus booking; do
                    docker build -t busbooking-${service}:${IMAGE_TAG} services/${service}-service
                    trivy image --exit-code 1 --severity HIGH,CRITICAL busbooking-${service}:${IMAGE_TAG}
                  done
                '''
            }
        }

        stage('Push to ECR') {
            steps {
                withCredentials([[$class: 'AmazonWebServicesCredentialsBinding',
                                  credentialsId: "${AWS_CREDS}",
                                  accessKeyVariable: 'AWS_ACCESS_KEY_ID',
                                  secretKeyVariable: 'AWS_SECRET_ACCESS_KEY']]) {
                    sh '''
                      set -eu
                      test -n "$ECR_REGISTRY"
                      aws ecr get-login-password --region "$AWS_REGION" |
                        docker login --username AWS --password-stdin "$ECR_REGISTRY"
                      for service in user bus booking; do
                        docker tag busbooking-${service}:${IMAGE_TAG} "$ECR_REGISTRY/busbooking-${service}:${IMAGE_TAG}"
                        docker push "$ECR_REGISTRY/busbooking-${service}:${IMAGE_TAG}"
                      done
                    '''
                }
            }
        }

        stage('Deploy to EC2') {
            when { expression { return params.EC2_HOST?.trim() && params.ECR_REGISTRY?.trim() } }
            steps {
                sshagent(credentials: ["${SSH_CREDS}"]) {
                    sh '''
                      set -eu
                      ssh -o StrictHostKeyChecking=accept-new "$SSH_USER@$EC2_HOST" \
                        "mkdir -p ~/busbooking/nginx"
                      scp -o StrictHostKeyChecking=accept-new compose.prod.yaml "$SSH_USER@$EC2_HOST:~/busbooking/"
                      scp -o StrictHostKeyChecking=accept-new nginx/default.conf "$SSH_USER@$EC2_HOST:~/busbooking/nginx/default.conf"
                      ssh -o StrictHostKeyChecking=accept-new "$SSH_USER@$EC2_HOST" \
                        "cd ~/busbooking && printf 'ECR_REGISTRY=%s\\nUSER_IMAGE_TAG=%s\\nBUS_IMAGE_TAG=%s\\nBOOKING_IMAGE_TAG=%s\\nGRAFANA_ADMIN_PASSWORD=%s\\n' '$ECR_REGISTRY' '$IMAGE_TAG' '$IMAGE_TAG' '$IMAGE_TAG' 'CHANGE_ME' > .env && aws ecr get-login-password --region '$AWS_REGION' | docker login --username AWS --password-stdin '$ECR_REGISTRY' && docker compose --env-file .env -f compose.prod.yaml pull && docker compose --env-file .env -f compose.prod.yaml up -d"
                    '''
                }
            }
        }

        stage('Verify Deployment') {
            when { expression { return params.EC2_HOST?.trim() } }
            steps {
                sh '''
                  set -eu
                  for route in users buses bookings; do
                    curl --fail --retry 10 --retry-delay 5 "http://${EC2_HOST}/api/${route}/health"
                  done
                '''
            }
        }
    }

    post {
        always {
            sh 'docker image prune -f || true'
            echo "BusBooking pipeline completed with status: ${currentBuild.currentResult}"
        }
    }
}
