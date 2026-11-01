# Self-hosted CardFacts API. Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t cardfacts-api .
#   docker run --rm -p 8787:8787 cardfacts-api
# Rebuild (or send SIGHUP after updating a mounted checkout) to serve newer data.
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile
COPY catalog.json tsconfig.json ./
COPY data ./data
COPY history ./history
COPY maintenance ./maintenance
COPY schema ./schema
COPY scripts ./scripts
COPY site ./site
COPY vectors ./vectors
COPY vocab ./vocab
ENV HOST=0.0.0.0 PORT=8787
USER node
EXPOSE 8787
CMD ["node", "--import", "tsx", "scripts/api-server.ts"]
