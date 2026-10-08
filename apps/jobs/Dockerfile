# Build from the repository root: docker build -f apps/jobs/Dockerfile -t discords-jobs .
FROM ghcr.io/nubjs/nub:0.9.2-alpine AS base

WORKDIR /app

FROM base AS dependencies
COPY --chown=node:node package.json nub.lock ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node apps/bot/package.json apps/bot/package.json
COPY --chown=node:node apps/jobs/package.json apps/jobs/package.json
COPY --chown=node:node packages/db/package.json packages/db/package.json
RUN nub ci

FROM base AS jobs
ENV NODE_ENV=production
ENV JOBS_DASHBOARD_PORT=3002
ENV JOBS_DASHBOARD_HOST=0.0.0.0
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/apps/jobs ./apps/jobs
COPY --chown=node:node package.json nub.lock tsconfig.json .env.schema ./
COPY --chown=node:node apps/jobs ./apps/jobs
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.JOBS_DASHBOARD_PORT + '/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["nub", "--cwd", "apps/jobs", "run", "start"]
