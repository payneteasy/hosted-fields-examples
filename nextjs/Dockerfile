# The Next.js example, for docker-compose.yml at the repository root.
#
# Two stages: `output: 'standalone'` gives one server.js plus a minimal node_modules, so the
# runtime image carries no yarn install.

FROM node:20 AS build
WORKDIR /src
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
# basePath is resolved by `next build` and baked into the output, unlike every other example
# where BASE_PATH is read at startup. It therefore has to be a build argument — and compose
# passes the same value again as a runtime variable, because src/shared/config/env.ts reads it
# independently to build the 3DS redirect_url. The two must agree.
ARG BASE_PATH=/hosted-fields-examples-nextjs
ENV BASE_PATH=$BASE_PATH
RUN yarn build

FROM node:20-slim
WORKDIR /opt/hosted-fields-examples-nextjs
# The three pieces a standalone build is assembled from, exactly as release.yml assembles them
COPY --from=build /src/.next/standalone/. ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
# HOSTNAME, not LISTEN_ADDR: the standalone server binds every interface unless it is told
# otherwise, and compose sets it to 127.0.0.1 the way the systemd unit does.
CMD ["node", "server.js"]
