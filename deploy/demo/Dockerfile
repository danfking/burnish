# Stage 1: Build
FROM node:20-slim AS builder

# Install pnpm + build tools for native modules (better-sqlite3)
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
    && apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy workspace config first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/components/package.json packages/components/
COPY packages/renderer/package.json packages/renderer/
COPY packages/server/package.json packages/server/
COPY packages/app/package.json packages/app/
COPY packages/example-server/package.json packages/example-server/
COPY apps/demo/package.json apps/demo/

RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild

# Copy source and build
COPY packages/ packages/
COPY apps/demo/ apps/demo/
RUN pnpm -r build

# Pre-install MCP server packages so npx doesn't download at runtime
RUN npm install -g @modelcontextprotocol/server-filesystem@latest @modelcontextprotocol/server-sqlite@latest

# Stage 2: Runtime
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install tsx for running TypeScript server + pnpm for workspace resolution
RUN npm install -g tsx \
    && corepack enable && corepack prepare pnpm@9.15.4 --activate

# Create non-root user
RUN groupadd -r burnish && useradd -r -g burnish -m burnish

WORKDIR /app

# Copy built workspace
COPY --from=builder /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml /build/tsconfig.base.json ./
COPY --from=builder /build/node_modules/ node_modules/
COPY --from=builder /build/packages/ packages/
COPY --from=builder /build/apps/demo/ apps/demo/

# Copy global npm packages (MCP servers)
COPY --from=builder /usr/local/lib/node_modules/ /usr/local/lib/node_modules/
COPY --from=builder /usr/local/bin/npx /usr/local/bin/npx

# Copy sample data and MCP config
COPY deploy/demo/sample-data/ /data/
COPY deploy/demo/mcp-servers.demo.json /app/apps/demo/mcp-servers.json

# Set ownership
RUN chown -R burnish:burnish /app /data

USER burnish

# Environment
ENV LLM_BACKEND=none
ENV TRUST_PROXY=true
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

CMD ["tsx", "apps/demo/server/index.ts"]
