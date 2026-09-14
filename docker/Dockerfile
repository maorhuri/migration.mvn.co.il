# Build stage for backend
FROM golang:1.22-alpine AS backend-builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy source code
COPY backend/ ./

# Baked into the binary and exposed on /api/v1/health, so a deploy can verify from the outside
# which commit is actually running rather than trusting Docker's own build/image bookkeeping
# (which has proven unreliable to query right after a build in this environment). Referencing
# the ARG in a RUN instruction also means a changed commit always invalidates the build cache
# from here on, so this step can never silently reuse an older binary.
ARG GIT_SHA=unknown

# Build the server
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -ldflags "-X main.GitSHA=${GIT_SHA}" -o server ./cmd/server

# Build the CLI
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o migration-cli ./cmd/cli

# Build stage for frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY frontend/package.json ./
RUN npm install

# Copy source code
COPY frontend/ ./

# Build
RUN npm run build

# Final stage
FROM alpine:3.19

WORKDIR /app

# Install runtime dependencies (lftp, GNU tar, gzip and mysqldump serve the agentless FTP/WordPress sources)
RUN apk add --no-cache ca-certificates tzdata openssh-client rsync lftp tar gzip mariadb-client

# Copy binaries from build stages
COPY --from=backend-builder /app/server /app/server
COPY --from=backend-builder /app/migration-cli /usr/local/bin/migration-cli
COPY --from=frontend-builder /app/dist /app/frontend/dist

# Create work directory
RUN mkdir -p /var/lib/migration-tool/work

# Environment variables
ENV PORT=8080
ENV ENVIRONMENT=production
ENV LOG_PRETTY=false
ENV WORK_DIR=/var/lib/migration-tool/work

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/v1/health || exit 1

# Run the server
CMD ["/app/server"]
