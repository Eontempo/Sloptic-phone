FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
ENV NODE_ENV=production
ENV PORT=3000
ENV MAX_AUDIO_MB=200
EXPOSE 3000
VOLUME ["/app/uploads"]
CMD ["node", "server.js"]
