# syntax=docker/dockerfile:1
# Build context: the repository root (the API depends on the rules workspace).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/rules/package.json packages/rules/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN npm ci --workspace @integration-doctor/rules --workspace @integration-doctor/api
COPY packages/rules packages/rules
COPY packages/api packages/api
RUN npm run build --workspace @integration-doctor/rules --workspace @integration-doctor/api

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/rules/package.json packages/rules/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev --workspace @integration-doctor/api && npm cache clean --force

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/rules/package.json packages/rules/
COPY --from=build /app/packages/rules/dist packages/rules/dist
COPY --from=build /app/packages/api/package.json packages/api/
COPY --from=build /app/packages/api/dist packages/api/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "packages/api/dist/src/main.js"]
