# The Go + React example, for docker-compose.yml at the repository root.
#
# Three stages, because the browser half has to be built before the server is: `yarn build`
# writes web/dist, the //go:embed in main.go puts that inside the binary, and the artefact is
# that one static binary. Neither Node nor node_modules reaches the runtime image.
#
# Note what is missing next to nextjs/'s Dockerfile: there is no ARG BASE_PATH. Nothing about
# the prefix is compiled into this bundle — the pages find their assets with relative URLs and
# the server through window.CONFIG.basePath — so the same image serves under any BASE_PATH
# compose hands it at runtime.

FROM node:20 AS web
WORKDIR /web
COPY web/package.json web/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY web/ ./
RUN yarn build

FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY . .
COPY --from=web /web/dist ./web/dist
# The same flags release.yml uses. CGO off so the binary runs on a distro with no toolchain.
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/hosted-fields-examples-go-react .

FROM debian:bookworm-slim
# The app calls the gateway over HTTPS and the slim image ships no trust store
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/hosted-fields-examples-go-react
COPY --from=build /out/hosted-fields-examples-go-react .
# PORT, LISTEN_ADDR and the rest arrive as real environment variables from compose. The default
# LISTEN_ADDR is 127.0.0.1 and stays that way: every app shares the nginx container's network
# namespace, so loopback is exactly where nginx looks for it.
CMD ["./hosted-fields-examples-go-react"]
