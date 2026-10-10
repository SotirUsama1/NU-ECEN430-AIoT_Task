FROM node:22-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY src ./src

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /home/node/.ssh \
    && chown node:node /home/node/.ssh \
    && chmod 700 /home/node/.ssh

ENV NODE_ENV=production
ENV DASHBOARD_HOST=0.0.0.0
EXPOSE 3001
USER node

CMD ["node", "src/server.js"]
