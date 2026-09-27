FROM node:26-alpine

WORKDIR /app
RUN npm install --global @nubjs/nub@0.9.2
COPY package.json nub.lock ./
COPY apps/bot/package.json apps/bot/package.json
COPY packages/db/package.json packages/db/package.json
RUN nub ci
COPY apps/bot apps/bot
COPY packages/db packages/db
COPY tsconfig.json ./

CMD ["nub", "--cwd", "apps/bot", "run", "start"]
