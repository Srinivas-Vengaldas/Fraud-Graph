# API + analyst UI in one image. Build from the repo root:  docker compose build api
FROM node:20-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-bookworm-slim AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production LOG_LEVEL=info API_PORT=3000
WORKDIR /app/server
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY server/package.json ./
COPY server/migrations ./migrations
COPY --from=web /app/web/dist /app/web/dist
# Model artifacts (model.onnx, feature_spec.json, thresholds.json) if trained; rules-only otherwise.
COPY ml/ /app/ml/
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx node-pg-migrate -m migrations -j sql up && node dist/index.js"]
