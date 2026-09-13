# The Express + TypeScript example, for docker-compose.yml at the repository root.
#
# Two stages: `npm run build` type-checks with tsc and then bundles express into dist/server.js,
# copying views/ and public/ beside it, so the runtime image needs no node_modules at all — and
# no TypeScript either, the artefact is plain JavaScript.
#
# node:22 rather than the node:20 its JavaScript sibling uses: `npm start` runs src/server.ts
# directly, which needs the type stripping Node gained in 22.18.

FROM node:22 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /opt/hosted-fields-examples-nodejs-express-ts-js
COPY --from=build /src/dist/. .
# `node server.js` and never `npm start`, which is `node --env-file=.env …` and hard-fails when
# there is no .env — settings arrive as real environment variables here.
#
# The working directory matters: server.js looks for views/ and public/ beside itself.
CMD ["node", "server.js"]
