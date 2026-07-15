FROM node:22-alpine
WORKDIR /app
RUN mkdir -p /app/data
COPY package*.json ./
RUN npm ci --only=production
COPY server/dist /app/server/dist
COPY web /app/web
COPY server/src/db/consent-seeds.json /app/server/dist/db/consent-seeds.json
ENV NODE_ENV=production
ENV PORT=3456
ENV DB_PATH=/app/data/myhistoree.db
EXPOSE 3456
CMD ["node", "server/dist/index.js"]
