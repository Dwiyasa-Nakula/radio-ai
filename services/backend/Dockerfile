FROM node:20-bookworm-slim AS build
WORKDIR /workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 \
  && ln -s /usr/bin/python3 /usr/local/bin/python \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/backend/package.json services/backend/package.json
RUN npm ci --legacy-peer-deps
COPY packages/contracts packages/contracts
COPY services/backend services/backend
COPY src/app/lib src/app/lib
COPY public/ads public/ads
COPY ["public/Intro jingles", "public/Intro jingles"]
COPY ["public/Outro Jingle", "public/Outro Jingle"]
RUN npm run build:backend

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 \
  && ln -s /usr/bin/python3 /usr/local/bin/python \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /workspace/services/backend/package.json services/backend/package.json
RUN npm ci --omit=dev --legacy-peer-deps --workspace @radio-ai/backend
COPY --from=build /workspace/services/backend/dist services/backend/dist
COPY --from=build /workspace/public/ads public/ads
COPY --from=build ["/workspace/public/Intro jingles", "public/Intro jingles"]
COPY --from=build ["/workspace/public/Outro Jingle", "public/Outro Jingle"]
USER node
EXPOSE 8080
CMD ["node", "services/backend/dist/server.mjs"]
