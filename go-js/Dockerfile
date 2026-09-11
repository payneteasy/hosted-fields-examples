# The Go example, for docker-compose.yml at the repository root.
#
# Two stages, because the artefact is one static binary with views/ and public/ inside it
# (//go:embed in main.go) — there is nothing else to carry to the runtime image.

FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY . .
# The same flags release.yml uses. CGO off so the binary runs on a distro with no toolchain.
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/hosted-fields-examples-go .

FROM debian:bookworm-slim
# The app calls the gateway over HTTPS and the slim image ships no trust store
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/hosted-fields-examples-go
COPY --from=build /out/hosted-fields-examples-go .
# PORT, LISTEN_ADDR and the rest arrive as real environment variables from compose. The default
# LISTEN_ADDR is 127.0.0.1 and stays that way: every app shares the nginx container's network
# namespace, so loopback is exactly where nginx looks for it.
CMD ["./hosted-fields-examples-go"]
