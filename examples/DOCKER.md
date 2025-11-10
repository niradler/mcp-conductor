# Docker Deployment Guide for MCP Conductor

This guide covers advanced Docker deployment scenarios for MCP Conductor.

## Table of Contents

- [Quick Start](#quick-start)
- [Production Deployment](#production-deployment)
- [Security Hardening](#security-hardening)
- [Multi-Container Setup](#multi-container-setup)
- [CI/CD Integration](#cicd-integration)
- [Monitoring & Logging](#monitoring--logging)

## Quick Start

### Build and Run

```bash
# Build the image
docker build -t mcp-conductor:latest .

# Run with stdio transport
docker run --rm -i \
  -v $(pwd)/workspace:/workspace \
  mcp-conductor:latest stdio

# Run with HTTP transport
docker run -d \
  --name mcp-conductor \
  -p 3000:3000 \
  -v $(pwd)/workspace:/workspace \
  mcp-conductor:latest http
```

### Using Docker Compose

```bash
# Start basic service (no network)
docker-compose up -d mcp-conductor

# Start with network access
docker-compose up -d mcp-conductor-network

# Start HTTP server
docker-compose up -d mcp-conductor-http

# View logs
docker-compose logs -f mcp-conductor

# Stop services
docker-compose down
```

## Production Deployment

### Using a Named Volume

```bash
# Create a named volume for persistent workspace
docker volume create mcp-workspace

# Run with named volume
docker run -d \
  --name mcp-conductor \
  -p 3000:3000 \
  -v mcp-workspace:/workspace \
  --restart unless-stopped \
  mcp-conductor:latest http
```

### Environment Variables

```bash
docker run -d \
  --name mcp-conductor \
  -p 3000:3000 \
  -v mcp-workspace:/workspace \
  -e MCP_CONDUCTOR_WORKSPACE=/workspace \
  -e MCP_CONDUCTOR_RUN_ARGS="allow-read=/workspace,allow-write=/workspace,allow-net" \
  -e MCP_CONDUCTOR_DEFAULT_TIMEOUT=60000 \
  -e MCP_CONDUCTOR_MAX_TIMEOUT=300000 \
  --restart unless-stopped \
  mcp-conductor:latest http
```

### Resource Limits

```bash
docker run -d \
  --name mcp-conductor \
  --memory="1g" \
  --cpus="2.0" \
  --memory-swap="1g" \
  -v mcp-workspace:/workspace \
  mcp-conductor:latest http
```

## Security Hardening

### Read-Only Root Filesystem

```bash
docker run -d \
  --name mcp-conductor \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  -v mcp-workspace:/workspace \
  mcp-conductor:latest http
```

### Non-Root User (Custom Dockerfile)

Create a hardened Dockerfile:

```dockerfile
FROM denoland/deno:2.1.4

RUN groupadd -r mcpuser && useradd -r -g mcpuser mcpuser

WORKDIR /app
RUN chown mcpuser:mcpuser /app

COPY --chown=mcpuser:mcpuser deno.json deno.lock ./
USER mcpuser
RUN deno install --entrypoint deno.json

COPY --chown=mcpuser:mcpuser src ./src

ENV MCP_CONDUCTOR_WORKSPACE=/workspace

ENTRYPOINT ["deno", "run", "--no-prompt", "--allow-read", "--allow-write", "--allow-net", "--allow-env", "--allow-run=deno", "src/cli/cli.ts"]
CMD ["stdio"]
```

### Network Security

```bash
# Create isolated network
docker network create --driver bridge mcp-network

# Run container in isolated network
docker run -d \
  --name mcp-conductor \
  --network mcp-network \
  --no-new-privileges \
  -v mcp-workspace:/workspace \
  mcp-conductor:latest http
```

## Multi-Container Setup

### docker-compose.yml for Multi-Service

```yaml
version: "3.8"

services:
  mcp-conductor:
    image: mcp-conductor:latest
    container_name: mcp-conductor
    networks:
      - mcp-network
    volumes:
      - workspace:/workspace
    environment:
      MCP_CONDUCTOR_WORKSPACE: /workspace
      MCP_CONDUCTOR_RUN_ARGS: allow-read=/workspace,allow-write=/workspace
    restart: unless-stopped

  mcp-conductor-http:
    image: mcp-conductor:latest
    container_name: mcp-conductor-http
    command: ["http"]
    ports:
      - "3000:3000"
    networks:
      - mcp-network
    volumes:
      - workspace:/workspace
    environment:
      MCP_CONDUCTOR_WORKSPACE: /workspace
      MCP_CONDUCTOR_RUN_ARGS: allow-read=/workspace,allow-write=/workspace,allow-net
      PORT: 3000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:alpine
    container_name: mcp-nginx
    ports:
      - "80:80"
      - "443:443"
    networks:
      - mcp-network
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - mcp-conductor-http
    restart: unless-stopped

networks:
  mcp-network:
    driver: bridge

volumes:
  workspace:
    driver: local
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Build and Push Docker Image

on:
  push:
    tags:
      - "v*"

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            yourusername/mcp-conductor:latest
            yourusername/mcp-conductor:${{ github.ref_name }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### GitLab CI

```yaml
docker-build:
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG
  only:
    - tags
```

## Monitoring & Logging

### Logging with Docker

```bash
# View logs
docker logs mcp-conductor

# Follow logs
docker logs -f mcp-conductor

# Last 100 lines
docker logs --tail 100 mcp-conductor

# With timestamps
docker logs -t mcp-conductor
```

### JSON File Logging Driver

```bash
docker run -d \
  --name mcp-conductor \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  mcp-conductor:latest http
```

### Prometheus Metrics (Future Feature)

Example docker-compose.yml with monitoring:

```yaml
services:
  mcp-conductor:
    image: mcp-conductor:latest
    environment:
      ENABLE_METRICS: "true"
      METRICS_PORT: 9090

  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    depends_on:
      - prometheus
```

## Troubleshooting

### Common Issues

**Container exits immediately:**

```bash
# Check exit code
docker inspect mcp-conductor --format='{{.State.ExitCode}}'

# View logs
docker logs mcp-conductor
```

**Permission denied:**

```bash
# Fix volume permissions
docker run --rm -v mcp-workspace:/workspace alpine chmod -R 755 /workspace
```

**Out of memory:**

```bash
# Check memory usage
docker stats mcp-conductor

# Increase memory limit
docker update --memory="2g" mcp-conductor
```

**Cannot connect to HTTP endpoint:**

```bash
# Check if container is running
docker ps | grep mcp-conductor

# Check port mapping
docker port mcp-conductor

# Test from inside container
docker exec mcp-conductor curl -f http://localhost:3000/health
```

## Best Practices

1. **Always use specific versions** in production:

   ```yaml
   image: mcp-conductor:0.1.1
   ```

2. **Set resource limits** to prevent resource exhaustion:

   ```yaml
   deploy:
     resources:
       limits:
         memory: 1G
         cpus: "2.0"
   ```

3. **Use health checks** for automatic recovery:

   ```yaml
   healthcheck:
     test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
     interval: 30s
   ```

4. **Implement logging strategy** for debugging:

   ```yaml
   logging:
     driver: "json-file"
     options:
       max-size: "10m"
       max-file: "3"
   ```

5. **Use secrets for sensitive data**:
   ```bash
   docker secret create mcp_config config.json
   docker service create --secret mcp_config mcp-conductor
   ```

## Advanced Topics

### Multi-Stage Build for Smaller Images

```dockerfile
FROM denoland/deno:2.1.4 AS deps
WORKDIR /app
COPY deno.json deno.lock ./
RUN deno install --entrypoint deno.json

FROM denoland/deno:2.1.4 AS runtime
WORKDIR /app
COPY --from=deps /root/.cache/deno /root/.cache/deno
COPY src ./src
COPY deno.json ./

ENV MCP_CONDUCTOR_WORKSPACE=/workspace
ENTRYPOINT ["deno", "run", "--no-prompt", "--allow-read", "--allow-write", "--allow-net", "--allow-env", "--allow-run=deno", "src/cli/cli.ts"]
CMD ["stdio"]
```

### Using Docker Secrets

```bash
# Create secret
echo "your-secret-value" | docker secret create mcp_secret -

# Use in service
docker service create \
  --name mcp-conductor \
  --secret mcp_secret \
  mcp-conductor:latest
```

### Docker Swarm Deployment

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml mcp-stack

# Scale service
docker service scale mcp-stack_mcp-conductor=3

# View services
docker service ls

# Remove stack
docker stack rm mcp-stack
```

---

For more information, see the main [README.md](../README.md) and [Security Documentation](../docs/SECURITY.md).
