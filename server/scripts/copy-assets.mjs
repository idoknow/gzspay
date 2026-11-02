// 构建后把非 TypeScript 资源复制到 dist（当前只需要 database schema）。
// IP 归属地数据放在 server/assets，dist 与源码引用同一份，无需复制。
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const assets = [["src/db/schema.sql", "dist/db/schema.sql"]];

for (const [from, to] of assets) {
  const source = path.join(serverRoot, from);
  const target = path.join(serverRoot, to);
  if (!existsSync(source)) {
    console.error(`[copy-assets] 缺少文件: ${source}`);
    process.exit(1);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`[copy-assets] ${from} -> ${to}`);
}
