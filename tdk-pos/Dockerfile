FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_DEVICE_AGENT_URL=http://127.0.0.1:5168
ENV NEXT_PUBLIC_DEVICE_AGENT_URL=$NEXT_PUBLIC_DEVICE_AGENT_URL
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public

RUN mkdir -p /app/public/uploads/menu /app/storage/receipt-logo \
    && chown -R node:node /app/public/uploads /app/storage /app/.next

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/pos-settings/login-mode').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
