FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/index.js", "--http"]
