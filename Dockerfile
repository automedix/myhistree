FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN mkdir -p /app/data
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/server/dist /app/server/dist
COPY --from=builder /app/web /app/web
COPY --from=builder /app/server/src/db/consent-seeds.json /app/server/dist/db/consent-seeds.json
ENV NODE_ENV=production
ENV PORT=3456
ENV DB_PATH=/app/data/myhistoree.db
EXPOSE 3456
CMD ["node", "server/dist/index.js"]
