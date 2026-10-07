# Build from the repository root: docker build -f apps/api/Dockerfile -t discords-api .
FROM ghcr.io/nubjs/nub:0.9.2-alpine AS base

WORKDIR /app

FROM base AS dependencies
COPY --chown=node:node package.json nub.lock ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node apps/bot/package.json apps/bot/package.json
COPY --chown=node:node apps/jobs/package.json apps/jobs/package.json
COPY --chown=node:node packages/db/package.json packages/db/package.json
RUN nub ci

FROM base AS api
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/apps/api ./apps/api
COPY --from=dependencies --chown=node:node /app/packages/db ./packages/db
COPY --chown=node:node package.json nub.lock tsconfig.json .env.schema ./
COPY --chown=node:node apps/api ./apps/api
COPY --chown=node:node packages/db ./packages/db
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["sh", "/app/apps/api/docker-entrypoint.sh"]
CMD ["nub", "--cwd", "apps/api", "run", "start"]
