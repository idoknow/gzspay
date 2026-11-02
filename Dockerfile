# syntax=docker/dockerfile:1

# 多阶段构建：构建阶段安装全部依赖并编译前后端，运行阶段只保留生产依赖与产物。
# 运行镜像不包含源码与开发依赖，前端静态资源由后端同源托管。

ARG NODE_VERSION=24

# ---- 构建阶段 ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

# 先复制清单文件，命中 Docker 层缓存时不必重复安装依赖
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/gzspay.sqlite \
    UPLOAD_DIR=/data/uploads \
    AVATAR_DIR=/data/avatars \
    WEB_DIST_DIR=/app/web/dist

# 只安装生产依赖（express、nodemailer、zod 等），不包含 vite / typescript / vitest
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/assets ./server/assets
COPY --from=build /app/web/dist ./web/dist

# SQLite 与可能的运行时文件都放在 /data，挂载卷即可持久化；/app 保持只读更安全
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

# 镜像里没有 curl，用 Node 自带的 fetch 做健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/index.js"]
