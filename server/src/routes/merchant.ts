import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { generateQrPngBuffer } from "../lib/qr.js";
import { errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { CHANNELS, type Channel } from "../lib/types.js";
import { requestIp } from "../lib/types.js";
import { parse } from "../lib/validate.js";
import {
  channelQrContent,
  createProduct,
  deleteProduct,
  listProducts,
  merchantDtoOf,
  publicMerchantOf,
  requireMerchant,
  registerMerchant,
  replaceChannelQr,
  setChannelEnabled,
  sortProducts,
  updateMerchantInfo,
  updateProduct,
} from "../services/merchant.js";
import { getMerchant, verifyPaymentPassword } from "../services/users.js";

export const merchantRouter: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 10 },
});

function fileFrom(req: Parameters<typeof asyncHandler>[0] | never, field: string): Buffer | undefined {
  const files = (req as unknown as { files?: Record<string, Express.Multer.File[]> }).files;
  const file = files?.[field]?.[0];
  return file?.buffer;
}

function parseChannels(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // 兼容逗号分隔
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

merchantRouter.get("/", requireUser(), (req, res) => {
  const merchant = getMerchant(req.auth!.user.id);
  res.json({
    registered: merchant !== undefined,
    merchant: merchant ? merchantDtoOf(merchant) : null,
    channels: CHANNELS.map((channel) => channel),
  });
});

merchantRouter.post(
  "/register",
  requireUser(),
  upload.fields([
    { name: "qr_alipay", maxCount: 1 },
    { name: "qr_wechat", maxCount: 1 },
    { name: "qr_qq", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const body = req.body as { name?: string; noteRequirement?: string; channels?: unknown };
    const channels = parseChannels(body.channels);
    const files: Partial<Record<Channel, Buffer>> = {};
    for (const channel of CHANNELS) {
      const buffer = fileFrom(req as never, `qr_${channel}`);
      if (buffer) files[channel] = buffer;
    }
    const dto = await registerMerchant(
      req.auth!.user,
      {
        name: body.name,
        noteRequirement: body.noteRequirement,
        channels,
        files,
      },
      requestIp(req),
    );
    res.status(201).json({ merchant: dto });
  }),
);

const updateMerchantSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  noteRequirement: z.string().max(200).optional(),
});

merchantRouter.patch(
  "/",
  requireUser(),
  asyncHandler((req, res) => {
    const body = parse(updateMerchantSchema, req.body);
    const dto = updateMerchantInfo(req.auth!.user, body, requestIp(req));
    res.json({ merchant: dto });
  }),
);

merchantRouter.get(
  "/public/:userId",
  requireUser(),
  asyncHandler((req, res) => {
    res.json(publicMerchantOf(String(req.params.userId)));
  }),
);

const channelSchema = z.object({ channel: z.enum(["alipay", "wechat", "qq"]) });

merchantRouter.post(
  "/channels/:channel",
  requireUser(),
  upload.single("qr"),
  asyncHandler(async (req, res) => {
    const channel = parse(channelSchema, { channel: req.params.channel }).channel;
    const body = parse(z.object({ paymentPassword: z.string().trim().min(1, "请输入支付密码") }), req.body);
    verifyPaymentPassword(req.auth!.user, body.paymentPassword, requestIp(req));
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw errors.validation("请上传收款码图片");
    const dto = await replaceChannelQr(req.auth!.user, channel, file.buffer, requestIp(req));
    res.json({ merchant: dto });
  }),
);

merchantRouter.patch(
  "/channels/:channel",
  requireUser(),
  asyncHandler((req, res) => {
    const channel = parse(channelSchema, { channel: req.params.channel }).channel;
    const body = parse(z.object({ enabled: z.boolean() }), req.body);
    const dto = setChannelEnabled(req.auth!.user, channel, body.enabled, requestIp(req));
    res.json({ merchant: dto });
  }),
);

merchantRouter.get(
  "/channels/:channel/qr",
  requireUser(),
  asyncHandler(async (req, res) => {
    const channel = parse(channelSchema, { channel: req.params.channel }).channel;
    requireMerchant(req.auth!.user);
    const merchant = getMerchant(req.auth!.user.id)!;
    const content = channelQrContent(merchant.user_id, channel);
    const png = await generateQrPngBuffer(content);
    res.type("png").send(png);
  }),
);

// ---------------- 商品与发布 ----------------

merchantRouter.get("/products", requireUser(), (req, res) => {
  res.json({ items: listProducts(req.auth!.user) });
});

const productSchema = z.object({
  name: z.string().trim().min(1, "请填写商品名称").max(40),
  priceCents: z.number().int().positive("商品价格必须大于 0"),
  description: z.string().max(500).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

merchantRouter.post(
  "/products",
  requireUser(),
  asyncHandler((req, res) => {
    const body = parse(productSchema, req.body);
    const dto = createProduct(req.auth!.user, body);
    res.status(201).json({ product: dto });
  }),
);

merchantRouter.patch(
  "/products/sort",
  requireUser(),
  asyncHandler((req, res) => {
    const body = parse(z.object({ ids: z.array(z.string()).max(200) }), req.body);
    res.json({ items: sortProducts(req.auth!.user, body.ids) });
  }),
);

merchantRouter.patch(
  "/products/:id",
  requireUser(),
  asyncHandler((req, res) => {
    const body = parse(productSchema.partial(), req.body);
    const dto = updateProduct(req.auth!.user, String(req.params.id), body);
    res.json({ product: dto });
  }),
);

merchantRouter.delete(
  "/products/:id",
  requireUser(),
  asyncHandler((req, res) => {
    deleteProduct(req.auth!.user, String(req.params.id));
    res.json({ ok: true });
  }),
);
