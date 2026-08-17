# Two stages: compile with the dev dependencies, ship only the runtime ones.
# The server must not need a TypeScript loader in production.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json tsconfig.build.json ./
RUN npm ci --include=dev
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data
EXPOSE 4000
CMD ["sh", "-c", "node dist/seed.js && node dist/index.js"]
