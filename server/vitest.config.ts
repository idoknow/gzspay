import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    env: {
      NODE_ENV: "test",
      SESSION_SECRET: "gzspay-test-session-secret",
      APP_BASE_URL: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:5173",
      TEST_DATABASE_PATH: "data/test.sqlite",
      // 收紧登录限流阈值，方便测试「超过阈值返回 429」
      RATE_LIMIT_LOGIN_PER_MINUTE: "3",
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
