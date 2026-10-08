FROM node:26-alpine AS base

WORKDIR /app
RUN npm install --global @nubjs/nub@0.9.2
COPY package.json nub.lock ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/jobs/package.json apps/jobs/package.json
COPY packages/db/package.json packages/db/package.json
RUN nub ci
COPY apps/bot apps/bot
COPY apps/api apps/api
COPY apps/jobs apps/jobs
COPY packages/db packages/db
COPY tsconfig.json .env.schema ./

FROM base AS api
CMD ["nub", "--cwd", "apps/api", "run", "start"]

FROM base AS bot
ENV BOT_HEALTH_HOST=0.0.0.0
ENV BOT_HEALTH_PORT=3001
ENTRYPOINT ["sh", "/app/apps/bot/docker-entrypoint.sh"]
CMD ["nub", "--cwd", "apps/bot", "run", "start"]

FROM base AS jobs
CMD ["nub", "--cwd", "apps/jobs", "run", "start"]
