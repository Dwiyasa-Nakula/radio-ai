FROM node:22-bookworm-slim AS pot-build
ARG POT_PROVIDER_VERSION=1.3.1
ARG POT_PROVIDER_COMMIT=7608dd51ee813b48cf9a6d68c6e42cb197ce10e0
WORKDIR /opt
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$POT_PROVIDER_VERSION" \
  https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git bgutil-provider
RUN test "$(git -C /opt/bgutil-provider rev-parse HEAD)" = "$POT_PROVIDER_COMMIT"
WORKDIR /opt/bgutil-provider/server
RUN npm ci \
  && npm audit fix \
  && npm audit --omit=dev \
  && npx tsc \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS build
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

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    YT_DLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    YOUTUBE_PO_PROVIDER_URL=http://127.0.0.1:4416 \
    YOUTUBE_STREAMING_ENABLED=true
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp[default]==2026.3.17" bgutil-ytdlp-pot-provider==1.3.1 \
  && /opt/yt-dlp/bin/python -c "import importlib.metadata as m; assert m.version('yt-dlp-ejs'); assert m.version('bgutil-ytdlp-pot-provider')" \
  && rm -rf /var/lib/apt/lists/*
COPY --from=pot-build /opt/bgutil-provider/server /opt/bgutil-provider/server
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /workspace/services/backend/package.json services/backend/package.json
RUN npm ci --omit=dev --legacy-peer-deps --workspace @radio-ai/backend
COPY --from=build /workspace/services/backend/dist services/backend/dist
COPY --from=build /workspace/services/backend/run.mjs services/backend/run.mjs
COPY --from=build /workspace/public/ads public/ads
COPY --from=build ["/workspace/public/Intro jingles", "public/Intro jingles"]
COPY --from=build ["/workspace/public/Outro Jingle", "public/Outro Jingle"]
RUN chown -R node:node /app /opt/bgutil-provider
USER node
EXPOSE 8080
CMD ["node", "services/backend/run.mjs"]
