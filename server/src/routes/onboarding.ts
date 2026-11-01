import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { issueEmailCode, consumeEmailCode, latestCodeEmail } from "../lib/email.js";
import { errors } from "../lib/errors.js";
import { asyncHandler } from "../lib/http.js";
import { requireUser } from "../lib/http.js";
import { rateLimit, userKey } from "../lib/rate-limit.js";
import { parse } from "../lib/validate.js";
import { requestIp } from "../lib/types.js";
import type { OnboardStep, UserRow } from "../lib/types.js";
import {
  bindCampusCard,
  completeOnboarding,
  isValidEmailValue,
  onboardStepLabel,
  setPaymentPassword,
  setRealName,
  setStudentNo,
  setVerifiedEmail,
  toMe,
} from "../services/users.js";

export const onboardingRouter: Router = Router();

const STEP_ORDER: OnboardStep[] = ["name", "studentNo", "email", "card", "password", "done"];

function stepIndex(step: OnboardStep): number {
  return STEP_ORDER.indexOf(step);
}

/**
 * 引导步骤只能顺序推进：已有更后面的进度时，重复提交早前步骤直接返回当前状态。
 * 返回 true 表示应跳过本次写入。
 */
function shouldSkip(user: UserRow, step: OnboardStep): boolean {
  if (user.onboarded === 1) return true;
  return stepIndex(user.onboard_step) > stepIndex(step);
}

function onboardingPayload(user: UserRow) {
  return {
    step: user.onboarded === 1 ? "done" : user.onboard_step,
    // 步骤 key 列表（顺序固定），前端据此计算第几步与进度
    steps: STEP_ORDER.filter((step) => step !== "done"),
    nextStep: onboardStepLabel(user.onboarded === 1 ? "done" : user.onboard_step),
    me: toMe(user),
  };
}

onboardingRouter.get("/", requireUser({ allowFrozen: true }), (req, res) => {
  res.json(onboardingPayload(req.auth!.user));
});

const nameSchema = z.object({
  surname: z.string().trim().min(1, "请填写姓").max(20),
  givenName: z.string().trim().min(1, "请填写名").max(20),
});

onboardingRouter.post(
  "/name",
  requireUser({ allowFrozen: true }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(nameSchema, req.body);
    if (shouldSkip(user, "name")) {
      res.json(onboardingPayload(user));
      return;
    }
    const updated = setRealName(user, body.surname, body.givenName, requestIp(req));
    res.json(onboardingPayload(updated));
  }),
);

const studentNoSchema = z.object({ studentNo: z.string().trim().min(1, "请填写校学号") });

onboardingRouter.post(
  "/student-no",
  requireUser({ allowFrozen: true }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(studentNoSchema, req.body);
    if (shouldSkip(user, "studentNo")) {
      res.json(onboardingPayload(user));
      return;
    }
    if (stepIndex(user.onboard_step) < stepIndex("studentNo")) {
      throw errors.orderStatusInvalid("请先完成姓名填写");
    }
    const updated = setStudentNo(user, body.studentNo, requestIp(req));
    res.json(onboardingPayload(updated));
  }),
);

const emailStartSchema = z.object({ email: z.string().trim().min(1, "请填写邮箱") });

onboardingRouter.post(
  "/email/start",
  requireUser({ allowFrozen: true }),
  rateLimit({
    scope: "onboarding.email.start",
    limit: config.security.rateLimitEmailPerMinute,
    windowSeconds: 60,
    keyBy: userKey,
    message: "验证码发送过于频繁，请稍后再试",
  }),
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    const body = parse(emailStartSchema, req.body);
    if (shouldSkip(user, "email")) {
      res.json(onboardingPayload(user));
      return;
    }
    if (stepIndex(user.onboard_step) < stepIndex("email")) {
      throw errors.orderStatusInvalid("请先完成校学号填写");
    }
    if (!isValidEmailValue(body.email)) throw errors.validation("邮箱格式不正确");
    const issued = await issueEmailCode({
      user,
      purpose: "email_verify",
      email: body.email,
      scene: "绑定邮箱",
    });
    res.json({ ...issued });
  }),
);

const emailVerifySchema = z.object({
  email: z.string().trim().min(1),
  code: z.string().trim().min(4),
});

onboardingRouter.post(
  "/email/verify",
  requireUser({ allowFrozen: true }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(emailVerifySchema, req.body);
    if (shouldSkip(user, "email")) {
      res.json(onboardingPayload(user));
      return;
    }
    const pendingEmail = latestCodeEmail(user.id, "email_verify");
    if (!pendingEmail || pendingEmail.toLowerCase() !== body.email.toLowerCase()) {
      throw errors.validation("验证码与邮箱不匹配，请重新获取验证码");
    }
    consumeEmailCode({
      userId: user.id,
      purpose: "email_verify",
      code: body.code,
      ip: requestIp(req),
    });
    const updated = setVerifiedEmail(user, body.email, requestIp(req));
    res.json(onboardingPayload(updated));
  }),
);

const cardSchema = z.object({ cardContent: z.string().trim().min(1, "请扫描校园卡二维码") });

onboardingRouter.post(
  "/card",
  requireUser({ allowFrozen: true }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(cardSchema, req.body);
    if (shouldSkip(user, "card")) {
      res.json(onboardingPayload(user));
      return;
    }
    if (stepIndex(user.onboard_step) < stepIndex("card")) {
      throw errors.orderStatusInvalid("请先完成邮箱验证");
    }
    const updated = bindCampusCard(user, body.cardContent, requestIp(req));
    res.json(onboardingPayload(updated));
  }),
);

const passwordSchema = z.object({
  password: z.string().trim().min(1, "请设置支付密码"),
  confirm: z.string().trim().min(1, "请再次输入支付密码"),
});

onboardingRouter.post(
  "/payment-password",
  requireUser({ allowFrozen: true }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(passwordSchema, req.body);
    if (user.onboarded === 1) {
      res.json(onboardingPayload(user));
      return;
    }
    if (stepIndex(user.onboard_step) < stepIndex("password")) {
      throw errors.orderStatusInvalid("请先完成校园卡绑定");
    }
    if (body.password !== body.confirm) throw errors.validation("两次输入的支付密码不一致");
    setPaymentPassword(user, body.password, requestIp(req));
    completeOnboarding(user.id);
    res.json(onboardingPayload({ ...user, onboard_step: "done", onboarded: 1 }));
  }),
);

/** 版本号用于前端展示引导完整度（调试信息） */
onboardingRouter.get("/meta", (_req, res) => {
  res.json({
    version: config.version,
    steps: STEP_ORDER.filter((step) => step !== "done"),
  });
});
