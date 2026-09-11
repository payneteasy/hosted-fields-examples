# The Rust example, for docker-compose.yml at the repository root.
#
# Two stages, because the artefact is one binary with views/ and public/ inside it
# (include_dir! in main.rs) — there is nothing else to carry to the runtime image.

# 1.88, not the 1.85 this example declares as its minimum. src/main.rs:317 uses a let chain
# (`if let Some(..) = .. && ..`), which is unstable before 1.88 — so the crate does not in fact
# build on the version Cargo.toml and the READMEs name. CI never caught it because it installs
# whatever `stable` is. Worth fixing at the source; pinned here so this image builds.
FROM rust:1.88-bookworm AS build
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
