
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        AWS_REGION = 'ap-south-1'
        ECR_REGISTRY = '821589436375.dkr.ecr.ap-south-1.amazonaws.com'
        IMAGE_TAG = "v1.0.${BUILD_NUMBER}"
        DEPLOY_DIR = '/opt/busbooking'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm

                sh '''
                    echo "Git commit:"
                    git rev-parse --short HEAD

                    echo "Branch:"
                    git branch --show-current
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                    set -eu

                    echo "Running User Service tests..."
                    cd services/user-service
                    npm install --package-lock=false
                    npm test
                    cd ../..

                    echo "Running Bus Service tests..."
                    cd services/bus-service
                    npm install --package-lock=false
                    npm test
                    cd ../..

                    echo "Running Booking Service tests..."
                    cd services/booking-service
                    npm install --package-lock=false
                    npm test
                    cd ../..

                    echo "All tests completed successfully."
                '''
            }
        }

        stage('Validate') {
            steps {
                sh '''
                    set -eu

                    echo "Validating production Docker Compose..."

                    echo "Checking Dockerfiles..."

                    for service in user-service bus-service booking-service
                    do
                        test -f "services/$service/Dockerfile"
                        test -f "services/$service/package.json"
                        test -f "services/$service/src/server.js"
                    done

                    echo "Checking production Compose..."

                    cat > .env.validation <<EOF
ECR_REGISTRY=$ECR_REGISTRY
USER_IMAGE_TAG=$IMAGE_TAG
BUS_IMAGE_TAG=$IMAGE_TAG
BOOKING_IMAGE_TAG=$IMAGE_TAG
GRAFANA_ADMIN_PASSWORD=temporary-validation-password
EOF

                    docker compose \
                        --env-file .env.validation \
                        -f compose.prod.yaml \
                        config --quiet

                    rm -f .env.validation

                    echo "Validation completed successfully."
                '''
            }
        }

        stage('Build') {
            steps {
                sh '''
                    set -eu

                    echo "Building User Service..."

                    docker build \
                        -t busbooking-user-service:$IMAGE_TAG \
                        services/user-service

                    echo "Building Bus Service..."

                    docker build \
                        -t busbooking-bus-service:$IMAGE_TAG \
                        services/bus-service

                    echo "Building Booking Service..."

                    docker build \
                        -t busbooking-booking-service:$IMAGE_TAG \
                        services/booking-service

                    echo "Docker images built successfully."
                '''
            }
        }

        stage('Trivy Scan') {
            steps {
                sh '''
                    set -eu

                    echo "Scanning User Service..."

                    trivy image \
                        --exit-code 1 \
                        --severity HIGH,CRITICAL \
                        --no-progress \
                        busbooking-user-service:$IMAGE_TAG

                    echo "Scanning Bus Service..."

                    trivy image \
                        --exit-code 1 \
                        --severity HIGH,CRITICAL \
                        --no-progress \
                        busbooking-bus-service:$IMAGE_TAG

                    echo "Scanning Booking Service..."

                    trivy image \
                        --exit-code 1 \
                        --severity HIGH,CRITICAL \
                        --no-progress \
                        busbooking-booking-service:$IMAGE_TAG

                    echo "Trivy scans completed successfully."
                '''
            }
        }

        stage('Push to ECR') {
            steps {
                sh '''
                    set -eu

                    echo "Logging in to ECR..."

                    aws ecr get-login-password \
                        --region "$AWS_REGION" |
                        docker login \
                        --username AWS \
                        --password-stdin "$ECR_REGISTRY"

                    echo "Tagging User Service..."

                    docker tag \
                        busbooking-user-service:$IMAGE_TAG \
                        "$ECR_REGISTRY/busbooking-user-service:$IMAGE_TAG"

                    echo "Tagging Bus Service..."

                    docker tag \
                        busbooking-bus-service:$IMAGE_TAG \
                        "$ECR_REGISTRY/busbooking-bus-service:$IMAGE_TAG"

                    echo "Tagging Booking Service..."

                    docker tag \
                        busbooking-booking-service:$IMAGE_TAG \
                        "$ECR_REGISTRY/busbooking-booking-service:$IMAGE_TAG"

                    echo "Pushing User Service..."

                    docker push \
                        "$ECR_REGISTRY/busbooking-user-service:$IMAGE_TAG"

                    echo "Pushing Bus Service..."

                    docker push \
                        "$ECR_REGISTRY/busbooking-bus-service:$IMAGE_TAG"

                    echo "Pushing Booking Service..."

                    docker push \
                        "$ECR_REGISTRY/busbooking-booking-service:$IMAGE_TAG"

                    echo "All images pushed to ECR successfully."
                '''
            }
        }

        stage('Deploy to EC2') {
            steps {
                sh '''
                    set -eu

                    echo "Preparing deployment directory..."

                    mkdir -p "$DEPLOY_DIR"

                    echo "Copying deployment files..."

                    cp compose.prod.yaml \
                        "$DEPLOY_DIR/compose.prod.yaml"

                    mkdir -p "$DEPLOY_DIR/nginx"

                    cp nginx/default.conf \
                        "$DEPLOY_DIR/nginx/default.conf"

                    mkdir -p "$DEPLOY_DIR/monitoring"

                    cp monitoring/prometheus.yml \
                        "$DEPLOY_DIR/monitoring/prometheus.yml"

                    if [ -d "monitoring/grafana/provisioning" ]; then
                        mkdir -p "$DEPLOY_DIR/monitoring/grafana"

                        cp -r monitoring/grafana/provisioning \
                            "$DEPLOY_DIR/monitoring/grafana/"
                    fi

                    echo "Creating deployment environment..."

                    if [ ! -f "$DEPLOY_DIR/.env" ]; then
                        echo "GRAFANA_ADMIN_PASSWORD=CHANGE_ME" \
                            > "$DEPLOY_DIR/.env"

                        echo "WARNING: Configure a real Grafana password in $DEPLOY_DIR/.env"
                    fi

                    sed -i "s/^ECR_REGISTRY=.*/ECR_REGISTRY=$ECR_REGISTRY/" \
                        "$DEPLOY_DIR/.env" || true

                    sed -i "s/^USER_IMAGE_TAG=.*/USER_IMAGE_TAG=$IMAGE_TAG/" \
                        "$DEPLOY_DIR/.env" || true

                    sed -i "s/^BUS_IMAGE_TAG=.*/BUS_IMAGE_TAG=$IMAGE_TAG/" \
                        "$DEPLOY_DIR/.env" || true

                    sed -i "s/^BOOKING_IMAGE_TAG=.*/BOOKING_IMAGE_TAG=$IMAGE_TAG/" \
                        "$DEPLOY_DIR/.env" || true

                    grep -q "^ECR_REGISTRY=" "$DEPLOY_DIR/.env" ||
                        echo "ECR_REGISTRY=$ECR_REGISTRY" \
                        >> "$DEPLOY_DIR/.env"

                    grep -q "^USER_IMAGE_TAG=" "$DEPLOY_DIR/.env" ||
                        echo "USER_IMAGE_TAG=$IMAGE_TAG" \
                        >> "$DEPLOY_DIR/.env"

                    grep -q "^BUS_IMAGE_TAG=" "$DEPLOY_DIR/.env" ||
                        echo "BUS_IMAGE_TAG=$IMAGE_TAG" \
                        >> "$DEPLOY_DIR/.env"

                    grep -q "^BOOKING_IMAGE_TAG=" "$DEPLOY_DIR/.env" ||
                        echo "BOOKING_IMAGE_TAG=$IMAGE_TAG" \
                        >> "$DEPLOY_DIR/.env"

                    echo "Logging in to ECR..."

                    aws ecr get-login-password \
                        --region "$AWS_REGION" |
                        docker login \
                        --username AWS \
                        --password-stdin "$ECR_REGISTRY"

                    echo "Pulling new images..."

                    cd "$DEPLOY_DIR"

                    docker compose \
                        --env-file .env \
                        -f compose.prod.yaml \
                        pull

                    echo "Starting application..."

                    docker compose \
                        --env-file .env \
                        -f compose.prod.yaml \
                        up -d

                    echo "Deployment completed successfully."
                '''
            }
        }

        stage('Health Check') {
            steps {
                sh '''
                    set -eu

                    echo "Waiting for services..."

                    sleep 15

                    echo "Container status..."

                    cd "$DEPLOY_DIR"

                    docker compose \
                        --env-file .env \
                        -f compose.prod.yaml \
                        ps

                    echo "Checking User Service..."

                    curl --fail --retry 10 --retry-delay 5 \
                        http://127.0.0.1/api/users/health

                    echo "Checking Bus Service..."

                    curl --fail --retry 10 --retry-delay 5 \
                        http://127.0.0.1/api/buses/health

                    echo "Checking Booking Service..."

                    curl --fail --retry 10 --retry-delay 5 \
                        http://127.0.0.1/api/bookings/health

                    echo "All health checks passed successfully."
                '''
            }
        }
    }

    post {
        always {
            echo "BusBooking pipeline completed with status: ${currentBuild.currentResult}"
        }

        success {
            echo "SUCCESS: BusBooking application deployed successfully."
        }

        failure {
            echo "FAILURE: Check the Jenkins console output for the failed stage."
        }
    }
}
