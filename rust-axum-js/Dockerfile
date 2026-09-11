# The Rust example, for docker-compose.yml at the repository root.
#
# Two stages, because the artefact is one binary with views/ and public/ inside it
# (include_dir! in main.rs) — there is nothing else to carry to the runtime image.

# The version Cargo.toml declares. It really does build on it — see the comment at the nested
# `if let` in src/main.rs, which is there so that it does.
FROM rust:1.85-bookworm AS build
WORKDIR /src
COPY . .
# views/ and public/ have to be present here: include_dir! reads them at compile time
RUN cargo build --release

FROM debian:bookworm-slim
# reqwest uses rustls with the system trust store, and the slim image ships none
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/hosted-fields-examples-rust
COPY --from=build /src/target/release/hosted-fields-example-rust .
CMD ["./hosted-fields-example-rust"]
