FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY tsconfig.json ./
RUN mkdir -p /data
EXPOSE 4000
CMD ["sh", "-c", "npx tsx src/seed.ts && npx tsx src/index.ts"]
