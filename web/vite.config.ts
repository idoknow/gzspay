import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * gzspay 手机端前端构建配置。
 * 开发时把 /api 代理到后端（默认 3000 端口），生产由后端静态托管 web/dist 保证同源。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    cssTarget: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.1.0"),
  },
});
