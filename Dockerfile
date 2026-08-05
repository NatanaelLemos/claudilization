# syntax=docker/dockerfile:1
#
# Claudilization — standalone deploy (Fly.io).
#
# The client is built with no base path, so the app owns the origin and every
# asset is served from `/`. The same source, built with CLAWDIA_APP_BASE_PATH
# set, is what Clawdia's Apps tab runs — see README "Design: living under a
# base path". Nothing here is allowed to assume one or the other at runtime.

FROM node:22-slim AS base
WORKDIR /app
# @playwright/test is a devDependency and only used by the scenario suite;
# never let its postinstall pull browsers into an image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ---- build the client -------------------------------------------------------
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# base path deliberately unset: standalone serves at "/"
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx is a real dependency (the server runs from TypeScript source), so the
# production tree is enough to boot.
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
COPY --from=build /app/dist ./dist

# Bind wide inside the container; Fly's proxy terminates TLS in front of us.
ENV CLAUDILIZATION_HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
