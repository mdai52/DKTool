FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.23-bookworm AS backend-builder
WORKDIR /workspace/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend-builder /workspace/backend/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/dktool-server ./cmd/server

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=backend-builder /out/dktool-server ./server
COPY --from=frontend-builder /workspace/backend/web/dist ./web/dist
COPY backend/data/dktool.seed.db ./seed/dktool.seed.db
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
ENV DKTOOL_DB_PATH=/app/runtime-data/dktool.db
EXPOSE 8080
ENTRYPOINT ["./entrypoint.sh"]
