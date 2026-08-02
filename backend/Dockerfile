FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --no-audit --no-fund
COPY backend/ ./
COPY schemas/ /app/schemas/
RUN npm run build

FROM node:24.16.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=build /app/backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/migrations ./migrations
COPY --from=build /app/backend/public ./public
COPY --from=build /app/schemas /app/schemas
USER node
EXPOSE 8790
CMD ["node", "dist/src/index.js"]
