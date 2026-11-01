import { Router } from "express";
import { z } from "zod";
import { errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { generateQrPngBuffer } from "../lib/qr.js";
import { requestIp } from "../lib/types.js";
import { pagination, parse, toInt } from "../lib/validate.js";
import { resolveDynamicCode } from "../services/dynamic.js";
import {
  appealOrder,
  cancelOrder,
  confirmOrder,
  createOrderAsPayer,
  createOrderByMerchant,
  findOrderById,
  listOrders,
  markOrderNotReceived,
  markOrderPaid,
  orderQrContentForUser,
  readIdempotentResponse,
  requireOrderForUser,
  toOrderDto,
  writeIdempotentResponse,
  type OrderStatusFilter,
} from "../services/orders.js";
import { requireMerchant } from "../services/merchant.js";
import { resolveCardOwner, verifyPaymentPassword } from "../services/users.js";

export const ordersRouter: Router = Router();

type ParsedItem = { productId: string; quantity?: number };

/** 商品清单统一补齐数量，交给下单服务 */
function normalizeItems(items: ParsedItem[] | undefined): { productId: string; quantity: number }[] | undefined {
  return items?.map((item) => ({ productId: item.productId, quantity: item.quantity ?? 1 }));
}

ordersRouter.use(requireUser());

const itemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
});

const createOrderSchema = z.object({
  merchantUserId: z.string().min(1, "缺少商家标识"),
  items: z.array(itemSchema).max(20).optional(),
  amountCents: z.number().int().positive().optional(),
  reservedNote: z.string().max(200).nullable().optional(),
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
  idempotencyKey: z.string().trim().min(6).max(80),
  dynamicCodeToken: z.string().trim().min(6).max(200).optional(),
});

ordersRouter.post(
  "/",
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(createOrderSchema, req.body);
    const cached = readIdempotentResponse<{ order: unknown }>(user.id, body.idempotencyKey, "orders.create");
    if (cached) {
      res.status(200).json(cached);
      return;
    }
    // 双手机：客户扫商家动态码下单时，在这里消费一次性令牌
    if (body.dynamicCodeToken) {
      const resolution = resolveDynamicCode(body.dynamicCodeToken, user, { consume: true });
      if (resolution.user.id !== body.merchantUserId) {
        throw errors.validation("动态码与所选商家不一致，请重新扫码");
      }
    }
    verifyPaymentPassword(user, body.paymentPassword, requestIp(req));
    const order = createOrderAsPayer(
      user,
      {
        merchantUserId: body.merchantUserId,
        items: normalizeItems(body.items),
        amountCents: body.amountCents,
        reservedNote: body.reservedNote,
      },
      requestIp(req),
    );
    const payload = { order: toOrderDto(order, user.id) };
    writeIdempotentResponse(user.id, body.idempotencyKey, "orders.create", payload);
    res.status(201).json(payload);
  }),
);

const merchantCreateSchema = z.object({
  cardContent: z.string().trim().min(1, "请扫描客户校园卡"),
  items: z.array(itemSchema).max(20).optional(),
  amountCents: z.number().int().positive().optional(),
  reservedNote: z.string().max(200).nullable().optional(),
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
  idempotencyKey: z.string().trim().min(6).max(80),
});

/** 单手机收款：商家扫码 → 客户在商家手机上输入支付密码 */
ordersRouter.post(
  "/merchant-create",
  asyncHandler((req, res) => {
    const merchant = req.auth!.user;
    requireMerchant(merchant);
    const body = parse(merchantCreateSchema, req.body);
    const cached = readIdempotentResponse<{ order: unknown }>(
      merchant.id,
      body.idempotencyKey,
      "orders.merchant_create",
    );
    if (cached) {
      res.status(200).json(cached);
      return;
    }
    const customer = resolveCardOwner(body.cardContent);
    if (!customer) throw errors.notFound("该校园卡尚未绑定账号，请提醒对方先注册 gzspay");
    if (customer.id === merchant.id) throw errors.conflict("不能向自己收款");
    // 支付密码由客户在商家手机上输入：校验的是客户账号
    verifyPaymentPassword(customer, body.paymentPassword, requestIp(req));
    const order = createOrderByMerchant(
      merchant,
      {
        customer,
        items: normalizeItems(body.items),
        amountCents: body.amountCents,
        reservedNote: body.reservedNote,
      },
      requestIp(req),
    );
    const payload = { order: toOrderDto(order, merchant.id) };
    writeIdempotentResponse(merchant.id, body.idempotencyKey, "orders.merchant_create", payload);
    res.status(201).json(payload);
  }),
);

ordersRouter.get(
  "/",
  asyncHandler((req, res) => {
    const query = req.query as Record<string, unknown>;
    const scope = query.scope === "receive" ? "receive" : "pay";
    const statusValue = typeof query.status === "string" ? query.status : "all";
    const allowed: OrderStatusFilter[] = ["pending", "paid", "closed", "all"];
    const status = allowed.includes(statusValue as OrderStatusFilter)
      ? (statusValue as OrderStatusFilter)
      : "all";
    const { page, pageSize } = pagination(toInt(query.page, 1), toInt(query.pageSize, 20));
    res.json(listOrders(req.auth!.user, { scope, status, page, pageSize }));
  }),
);

ordersRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    const order = requireOrderForUser(String(req.params.id), req.auth!.user);
    res.json(toOrderDto(order, req.auth!.user.id));
  }),
);

ordersRouter.get(
  "/:id/qr",
  asyncHandler(async (req, res) => {
    const channel = typeof req.query.channel === "string" ? req.query.channel : "alipay";
    const content = orderQrContentForUser(String(req.params.id), req.auth!.user, channel);
    const png = await generateQrPngBuffer(content);
    res.type("png").send(png);
  }),
);

ordersRouter.post(
  "/:id/pay",
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        channel: z.enum(["alipay", "wechat", "qq"]),
        actualNote: z.string().max(200).nullable().optional(),
      }),
      req.body,
    );
    const order = markOrderPaid(String(req.params.id), req.auth!.user, body, requestIp(req));
    res.json(toOrderDto(order, req.auth!.user.id));
  }),
);

ordersRouter.post(
  "/:id/confirm",
  asyncHandler((req, res) => {
    const order = confirmOrder(String(req.params.id), req.auth!.user, requestIp(req));
    res.json(toOrderDto(order, req.auth!.user.id));
  }),
);

ordersRouter.post(
  "/:id/not-received",
  asyncHandler((req, res) => {
    const order = markOrderNotReceived(String(req.params.id), req.auth!.user, requestIp(req));
    res.json(toOrderDto(order, req.auth!.user.id));
  }),
);

const cancelSchema = z.object({
  reason: z.enum(["金额有误", "已线下结清", "对方未付款", "其他"]).or(z.string().trim().min(1).max(50)),
  note: z.string().max(200).nullable().optional(),
});

ordersRouter.post(
  "/:id/cancel",
  asyncHandler((req, res) => {
    const body = parse(cancelSchema, req.body);
    const order = cancelOrder(String(req.params.id), req.auth!.user, body, requestIp(req));
    res.json(toOrderDto(order, req.auth!.user.id));
  }),
);

ordersRouter.post(
  "/:id/appeal",
  asyncHandler((req, res) => {
    const body = parse(z.object({ reason: z.string().trim().min(1, "请填写申诉原因").max(500) }), req.body);
    const order = appealOrder(String(req.params.id), req.auth!.user, body, requestIp(req));
    res.json(toOrderDto(order, req.auth!.user.id));
  }),
);

export function orderDetailForAdmin(orderId: string): ReturnType<typeof toOrderDto> | null {
  const order = findOrderById(orderId);
  return order ? toOrderDto(order, order.payer_id) : null;
}

export { requireUser };
