# syntax=docker/dockerfile:1
# Build context: the repository root (the web app bundles the rules workspace).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/rules/package.json packages/rules/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN npm ci --workspace @integration-doctor/rules --workspace @integration-doctor/web
COPY packages/rules packages/rules
COPY packages/web packages/web
RUN npm run build --workspace @integration-doctor/rules --workspace @integration-doctor/web

FROM nginxinc/nginx-unprivileged:1.29-alpine
# Where nginx sends /api/; the image fills ${API_UPSTREAM} in at startup.
ENV API_UPSTREAM=http://api:3000
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
