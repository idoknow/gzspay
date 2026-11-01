import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { migrate, queryOne } from "../src/db/index.js";
import {
  alertKeyOf,
  buildAlertPayload,
  buildAlertText,
  reportSystemError,
  resetAlertsForTest,
  shouldDispatchAlert,
} from "../src/lib/alerts.js";

beforeAll(() => {
  migrate();
});

beforeEach(() => {
  resetAlertsForTest();
});

describe("严重错误告警", () => {
  it("所有错误都会写入系统错误日志；没有告警通道时不主动推送", () => {
    const result = reportSystemError({ scope: "http", message: "数据库连接超时" });
    // 测试环境既没有 SMTP 也没有 Webhook
    expect(result.alerted).toBe(false);
    expect(result.reason).toBe("disabled");
    const row = queryOne<{ source: string; message: string }>(
      "SELECT source, message FROM system_errors WHERE source = 'http' ORDER BY created_at DESC LIMIT 1",
    );
    expect(row?.message).toContain("数据库连接超时");
  });

  it("同一类错误在节流窗口内只告警一次，并累计被合并的次数", () => {
    const key = alertKeyOf("http", "订单 12345 保存失败");
    // 数字与 UUID 会被归一化，同一类错误命中同一个桶
    expect(alertKeyOf("http", "订单 67890 保存失败")).toBe(key);
    expect(
      alertKeyOf("http", "订单 3f2504e0-4f89-11d3-9a0c-0305e82c3301 保存失败"),
    ).toBe(key);

    const first = shouldDispatchAlert(key, 1_000_000);
    expect(first.allowed).toBe(true);
    expect(first.suppressed).toBe(0);

    const second = shouldDispatchAlert(key, 1_030_000);
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe("throttled");
    expect(second.suppressed).toBe(1);

    // 超过窗口后允许再次告警，并带上期间合并的次数
    const later = shouldDispatchAlert(key, 1_000_000 + (config.alerts.throttleMinutes + 1) * 60_000);
    expect(later.allowed).toBe(true);
    expect(later.suppressed).toBe(1);
  });

  it("不同来源分别节流", () => {
    const http = alertKeyOf("http", "连接超时");
    const mail = alertKeyOf("mail", "连接超时");
    expect(shouldDispatchAlert(http, 2_000_000).allowed).toBe(true);
    expect(shouldDispatchAlert(mail, 2_000_000).allowed).toBe(true);
    expect(shouldDispatchAlert(http, 2_010_000).allowed).toBe(false);
  });

  it("每小时告警次数有上限，超出后只记录不再推送", () => {
    let allowed = 0;
    for (let index = 0; index < config.alerts.maxPerHour + 5; index += 1) {
      const decision = shouldDispatchAlert(`scope-${index}`, 3_000_000 + index);
      if (decision.allowed) allowed += 1;
      else expect(decision.reason).toBe("hourly_limit");
    }
    expect(allowed).toBe(config.alerts.maxPerHour);
  });

  it("告警文案与 Webhook 载荷包含排查所需信息", () => {
    const input = {
      scope: "http",
      message: "数据库连接超时",
      context: "GET /api/orders",
    };
    const text = buildAlertText(input, 3);
    expect(text).toContain("http");
    expect(text).toContain("GET /api/orders");
    expect(text).toContain("数据库连接超时");
    expect(text).toContain("还有 3 次未单独告警");

    const payload = buildAlertPayload(input, 0);
    expect(payload.event).toBe("system_error");
    expect(payload.scope).toBe("http");
    expect(payload.message).toContain("数据库连接超时");
    expect(payload.environment).toBe(config.nodeEnv);
    expect(payload.version).toBe(config.version);
  });
});
