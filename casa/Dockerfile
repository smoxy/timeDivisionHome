FROM node:24-alpine AS interfaccia
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY --from=interfaccia /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
