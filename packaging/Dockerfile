FROM oven/bun:1.4.4 AS web
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/site/package.json apps/site/
COPY apps/web/package.json apps/web/
COPY packages/vault-core/package.json packages/vault-core/
RUN bun install --frozen-lockfile
COPY apps/web/ apps/web/
COPY packages/vault-core/ packages/vault-core/
RUN cd apps/web && bun run build

FROM golang:1.27.4-alpine AS go-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/keyfold-server/ apps/keyfold-server/
COPY apps/kf/ apps/kf/
COPY internal/ internal/
ARG VERSION=dev
ARG COMMIT=
ENV CGO_ENABLED=0
RUN ldflags="-X keyfold/internal/version.Version=${VERSION} -X keyfold/internal/version.Commit=${COMMIT}"; \
    go build -ldflags "$ldflags" -o /out/kf ./apps/kf && \
    go build -ldflags "$ldflags" -o /out/keyfold-server ./apps/keyfold-server

# BusyBox provides wget for the health check in a smaller base than Alpine.
FROM busybox:1.37.0-musl
COPY --from=go-build /out/keyfold-server /out/kf /usr/local/bin/
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=web /src/apps/web/dist/ /web/
RUN mkdir /data && chown 10001:10001 /data && chmod 0700 /data
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8717
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["wget", "-q", "-Y", "off", "-O", "/dev/null", "http://127.0.0.1:8717/api/v1/alive"]
ENTRYPOINT ["/usr/local/bin/keyfold-server", "-data", "/data", "-web", "/web"]
CMD ["-listen", "127.0.0.1:8717"]
