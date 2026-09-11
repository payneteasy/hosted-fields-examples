# The Express example, for docker-compose.yml at the repository root.
#
# Two stages: `npm run build` bundles express into dist/server.js and copies views/ and public/
# beside it, so the runtime image needs no node_modules at all.

FROM node:20 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /opt/hosted-fields-examples-nodejs-express-js
COPY --from=build /src/dist/. .
# `node server.js` and never `npm start`, which is `node --env-file=.env …` and hard-fails when
# there is no .env — settings arrive as real environment variables here.
#
# The working directory matters: server.js looks for views/ and public/ beside itself.
CMD ["node", "server.js"]
