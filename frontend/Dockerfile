FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173
# Vite dev server: hot-reloads on code changes (source is bind-mounted in docker-compose.yml)
CMD ["npm", "run", "dev"]
