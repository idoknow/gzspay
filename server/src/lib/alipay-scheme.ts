/**
 * 支付宝「预填金额与备注」唤起链接。
 *
 * 说明：这是支付宝客户端的深度链接（URL Scheme），并非官方开放接口。它的作用只是把
 * 收款方 PID、金额、备注带到「转账到支付宝账户」页面里，让付款人少输几个字；
 * 用户仍可在支付宝里自行修改金额，所以**不能作为到账凭据**，到账确认依旧依赖
 * 人工确认收款或账单对账。
 */

/** 支付宝用户 ID（PID）：2088 开头，13～21 位数字。 */
export const ALIPAY_PID_PATTERN = /^2088\d{12,20}$/;

/** 预填备注的最大长度：支付宝转账备注框较短，超长会被截断，这里主动截断避免出现半个字。 */
export const ALIPAY_MEMO_MAX = 32;

export function isValidAlipayPid(value: string): boolean {
  return ALIPAY_PID_PATTERN.test(value);
}

/** 分 → 「12.00」 */
export function formatYuan(amountCents: number): string {
  return (Math.round(amountCents) / 100).toFixed(2);
}

/** 备注去掉控制字符（换行、制表符等会破坏链接），并按码点截断。 */
export function sanitizeAlipayMemo(input: string): string {
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > ALIPAY_MEMO_MAX ? chars.slice(0, ALIPAY_MEMO_MAX).join("") : cleaned;
}

export interface AlipayPrefillInput {
  pid: string;
  amountCents: number;
  memo: string;
}

export interface AlipayPrefill {
  /** 手机端直接跳转的 scheme */
  scheme: string;
  /** 二维码内容（扫码后同样打开预填页面） */
  qrPayload: string;
  amountCents: number;
  /** 实际写进支付宝备注的文字 */
  memo: string;
}

/**
 * 拼出唤起链接：
 * 内层 `alipays://platformapi/startapp?appId=20000123&actionType=scan&biz_data={...}`
 * 外层再套一层 `appId=20000067&url=<内层>`，用于扫码唤起（二维码里放这一整条）。
 */
export function buildAlipayPrefill(input: AlipayPrefillInput): AlipayPrefill {
  if (!isValidAlipayPid(input.pid)) throw new Error("支付宝 PID 格式不正确");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("金额不正确");
  const memo = sanitizeAlipayMemo(input.memo);
  const bizData = JSON.stringify({ s: "money", u: input.pid, a: formatYuan(input.amountCents), m: memo });
  const inner = `alipays://platformapi/startapp?appId=20000123&actionType=scan&biz_data=${encodeURIComponent(bizData)}`;
  const qrPayload = `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(inner)}`;
  return { scheme: inner, qrPayload, amountCents: input.amountCents, memo };
}
