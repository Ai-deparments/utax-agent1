FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true
COPY src ./src
COPY public ./public
COPY deploy ./deploy
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8100/api/health || exit 1
CMD ["node", "src/server.mjs"]
