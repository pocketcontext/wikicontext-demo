# WikiContext Demo image for Basecamp ONCE: HTTP on port 80, GET /up, SQLite under /storage; originals in private S3.
# With WIKICONTEXT_DEMO_ONCE=true the image runs its own demo supervisor (deploy/demo/once_runtime.py):
# private control socket, nginx ingress gate, one writer, three replicas and the 00:00 UTC reset.
# Build context: this repository. See .dockerignore for the files that enter it.
#
# Pinned inputs and how to refresh them:
# - Base images: tag and index digest from Docker Hub's registry API
#   (HEAD /v2/library/<name>/manifests/<tag>, header docker-content-digest).
#   The Go tag must match the `go` line of pocketcontext's go.mod at POCKETCONTEXT_VERSION.
# - PocketContext: the commit in POCKETCONTEXT_VERSION; its Go modules are verified against go.sum.
# - Litestream: version and SHA-256 of the release archives, from the release's checksums.txt
#   (the same values as the asset digests of the GitHub release API).
# Debian packages (ca-certificates, tini, Python and boto3) are not version-pinned.
# They refresh only when this install layer is rebuilt; cached builds do not fetch updates.

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS reader
WORKDIR /ui
RUN npm install --global pnpm@10.33.2
COPY ui/package.json ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY ui/ ./
RUN pnpm typecheck && pnpm test && pnpm build

FROM golang:1.27.1-trixie@sha256:a4d1d139d0b0e7313de2fbe7cf4e27e3b934c164c5c58b33af44af2e9ba2fc4f AS build
ARG TARGETARCH
# Never download another Go toolchain: a go.mod that asks for a newer Go fails the build instead.
ENV GOTOOLCHAIN=local CGO_ENABLED=1

ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256_AMD64=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
ARG LITESTREAM_SHA256_ARM64=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) asset_arch=x86_64; sum="${LITESTREAM_SHA256_AMD64}" ;; \
      arm64) asset_arch=arm64; sum="${LITESTREAM_SHA256_ARM64}" ;; \
      *) echo "unsupported TARGETARCH '${TARGETARCH}': build with BuildKit for linux/amd64 or linux/arm64" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${asset_arch}.tar.gz"; \
    echo "downloading ${url}"; \
    curl -fsSL --retry 3 -o /tmp/litestream.tar.gz "${url}"; \
    echo "${sum}  /tmp/litestream.tar.gz" > /tmp/litestream.sha256; \
    sha256sum -c /tmp/litestream.sha256; \
    mkdir -p /out; \
    tar -xzf /tmp/litestream.tar.gz -C /out litestream; \
    rm /tmp/litestream.tar.gz /tmp/litestream.sha256; \
    /out/litestream version

WORKDIR /src
COPY POCKETCONTEXT_VERSION /tmp/POCKETCONTEXT_VERSION
RUN set -eu; \
    revision="$(cat /tmp/POCKETCONTEXT_VERSION)"; \
    if ! grep -Eqx '[0-9a-f]{40}' /tmp/POCKETCONTEXT_VERSION; then \
      echo "POCKETCONTEXT_VERSION must hold a 40-character commit SHA" >&2; exit 1; \
    fi; \
    echo "fetching github.com/pocketcontext/pocketcontext at ${revision}"; \
    git init -q .; \
    git remote add origin https://github.com/pocketcontext/pocketcontext.git; \
    git fetch -q --depth 1 origin "${revision}"; \
    git checkout -q --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "${revision}"
RUN go mod download && go mod verify
# The flags of pocketcontext's Makefile, plus -trimpath and a stripped binary.
RUN go build -trimpath -tags sqlite_math_functions,sqlite_percentile,sqlite_fts5 -ldflags '-s -w' -o /out/pocketcontext ./cmd/pocketcontext \
    && /out/pocketcontext --version


WORKDIR /supervisor
COPY supervisor/ ./
RUN go test ./... && go build -trimpath -ldflags '-s -w' -o /out/demo-supervisor ./cmd/demo-supervisor

FROM debian:trixie-20260918-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini python3 python3-boto3 nginx \
    && rm -rf /var/lib/apt/lists/* \
    && test -x /usr/bin/tini

COPY --from=build /out/pocketcontext /out/litestream /out/demo-supervisor /usr/local/bin/
COPY docker/litestream.yml /etc/litestream.yml
COPY --chmod=0755 docker/entrypoint.py /usr/local/bin/wikicontext-entrypoint.py
COPY --chmod=0755 deploy/demo/retention.py /usr/local/bin/wikicontext-demo-retention.py
COPY --chmod=0755 deploy/demo/contact_replica.py /usr/local/bin/wikicontext-demo-contact-replica.py
COPY --chmod=0755 deploy/demo/once_runtime.py /usr/local/bin/wikicontext-demo-once.py
COPY deploy/demo/verify_compatibility.py /usr/local/lib/wikicontext-demo/verify_compatibility.py
COPY deploy/demo/compatibility.json /usr/local/share/wikicontext-compatibility.json
COPY deploy/demo/reset.py /usr/local/lib/wikicontext-demo/reset.py
COPY deploy/demo/contact-litestream.yml /etc/wikicontext-demo-contacts-litestream.yml
WORKDIR /app
COPY POCKETCONTEXT_VERSION pocketcontext.json ./
COPY pb_migrations/ ./pb_migrations/
COPY deploy/demo/retention.py ./deploy/demo/retention.py
RUN python3 /usr/local/lib/wikicontext-demo/verify_compatibility.py /usr/local/share/wikicontext-compatibility.json
COPY pb_hooks/ ./pb_hooks/
COPY --from=reader /ui/dist/ ./ui/dist/
COPY legal/ ./legal/
# Read only as the installation contract's tested client pin; never executed by the server.
COPY skills/wikicontext/wikicontext ./skills/wikicontext/wikicontext

# The container runs as root. ONCE creates and mounts the /storage volume and offers no option to
# set its owner or the container's user, and the server binds port 80.
ENV WIKICONTEXT_RATE_LIMITS=true
VOLUME /storage
EXPOSE 80
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/wikicontext-entrypoint.py"]

ARG REVISION=unknown
ENV WIKICONTEXT_REVISION=${REVISION}
RUN printf '%s\n' "${REVISION}" > /usr/local/share/wikicontext-revision
LABEL org.opencontainers.image.title="WikiContext Demo" \
      org.opencontainers.image.description="Disposable public WikiContext demo: private personal wikis reset daily at 00:00 UTC" \
      org.opencontainers.image.source="https://github.com/pocketcontext/wikicontext-demo" \
      org.opencontainers.image.revision="${REVISION}"
