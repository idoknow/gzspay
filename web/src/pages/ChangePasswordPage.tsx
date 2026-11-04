/** 修改支付密码：邮箱验证码或校园墙再验证（两种方式任选）→ 内置键盘两次输入新密码。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BuiltInKeypad } from "../components/BuiltInKeypad";
import { PageHeader } from "../components/PageHeader";
import { Spinner } from "../components/Loading";
import { useToast } from "../components/Toast";
import {
  claimPaymentPasswordResetByCampux,
  confirmPaymentPasswordReset,
  startPaymentPasswordReset,
  verifyPaymentPasswordReset,
} from "../lib/api";
import { isSixDigitCode } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useCountdown } from "../lib/hooks";
import { useAuth } from "../lib/session";

type Step = "send" | "verify" | "password";

export function ChangePasswordPage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const { me, session } = useAuth();
  const [searchParams] = useSearchParams();
  const campuxVerified = searchParams.get("campux") === "1";
  const campuxReady = session.campuxConfigured !== false;
  const [step, setStep] = useState<Step>("send");
  const [sending, setSending] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"first" | "confirm">("first");
  const [firstPassword, setFirstPassword] = useState<string | null>(null);
  const countdown = useCountdown(60);
  const claimed = useRef(false);

  // 从校园墙授权回来：领取一次性重置凭证，直接进入设置新密码
  useEffect(() => {
    if (!campuxVerified || claimed.current) return;
    claimed.current = true;
    let active = true;
    setClaiming(true);
    claimPaymentPasswordResetByCampux()
      .then((result) => {
        if (!active) return;
        setResetToken(result.resetToken);
        setStep("password");
        toast.success("校园墙验证通过，请设置新的支付密码");
      })
      .catch((cause: unknown) => {
        if (active) toast.error(errorMessage(cause));
      })
      .finally(() => {
        if (!active) return;
        setClaiming(false);
        navigate("/me/password", { replace: true });
      });
    return () => {
      active = false;
    };
  }, [campuxVerified, navigate, toast]);

  const sendCode = async (): Promise<void> => {
    setSending(true);
    try {
      const result = await startPaymentPasswordReset();
      setStep("verify");
      setDevCode(result.devCode ?? null);
      countdown.restart(60);
      toast.success("验证码已发送至邮箱，10 分钟内有效");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async (): Promise<void> => {
    if (!isSixDigitCode(code)) {
      toast.error("请输入 6 位验证码");
      return;
    }
    setVerifying(true);
    try {
      const result = await verifyPaymentPasswordReset(code);
      setResetToken(result.resetToken);
      setStep("password");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setVerifying(false);
    }
  };

  const submitPassword = async (value: string): Promise<void> => {
    if (phase === "first") {
      setFirstPassword(value);
      setPhase("confirm");
      toast.info("请再次输入新密码");
      return;
    }
    if (value !== firstPassword) {
      setFirstPassword(null);
      setPhase("first");
      throw new Error("两次输入的密码不一致，请重新设置");
    }
    if (!resetToken) {
      throw new Error("验证已过期，请重新获取验证码");
    }
    try {
      await confirmPaymentPasswordReset({ resetToken, password: value, confirm: value });
      toast.success("支付密码已修改，动态收付款码已失效");
      navigate("/me", { replace: true });
    } catch (cause) {
      setFirstPassword(null);
      setPhase("first");
      throw cause;
    }
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="修改支付密码" back />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card p-4">
          <div className="flex items-center gap-2">
            {(["send", "verify", "password"] as Step[]).map((item, index) => (
              <div key={item} className="flex flex-1 items-center gap-2">
                <span
                  className={
                    index <= (step === "send" ? 0 : step === "verify" ? 1 : 2)
                      ? "flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white"
                      : "flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold text-muted"
                  }
                >
                  {index + 1}
                </span>
                {index < 2 ? <span className="h-px flex-1 bg-line" /> : null}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">当前邮箱：{me?.emailMasked || "未绑定"}</p>
        </section>

        {claiming ? (
          <section className="card flex items-center justify-center gap-2 p-6 text-sm text-muted">
            <Spinner size={18} />
            正在确认校园墙验证结果…
          </section>
        ) : null}

        {step === "send" && !claiming ? (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-text">选择验证方式</h2>
            <p className="text-xs leading-relaxed text-muted">
              支付密码用于创建订单与确认交易。修改前需要先验证身份，下面两种方式任选一种。
            </p>
            <button type="button" className="btn btn-primary btn-block" disabled={sending} onClick={() => void sendCode()}>
              {sending ? <Spinner size={16} /> : null}
              发送邮箱验证码
            </button>
            <p className="text-[11px] leading-relaxed text-muted">
              验证码会发到 {me?.email || "你的登录邮箱"}，10 分钟内有效。
            </p>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className="h-px flex-1 bg-line" />
              或
              <span className="h-px flex-1 bg-line" />
            </div>
            {campuxReady ? (
              <>
                <a className="btn btn-outline btn-block" href="/api/me/payment-password/reset/campux/start">
                  用校园墙账号验证
                </a>
                <p className="text-[11px] leading-relaxed text-muted">
                  会跳转到校园墙授权页，确认是本人账号后自动回到这里设置新密码。
                </p>
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted">
                管理员尚未配置校园墙登录，暂时只能使用邮箱验证。
              </p>
            )}
          </section>
        ) : null}

        {step === "verify" ? (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-text">输入验证码</h2>
            <p className="text-xs text-muted">验证码已发送至 {me?.emailMasked || "你的邮箱"}，10 分钟内有效。</p>
            <input
              className="input text-center text-lg tracking-[0.5em]"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 位验证码"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
            {devCode ? <p className="text-[11px] text-accent-strong">开发环境验证码：{devCode}</p> : null}
            <button type="button" className="btn btn-primary btn-block" disabled={verifying} onClick={() => void verifyCode()}>
              {verifying ? <Spinner size={16} /> : null}
              下一步
            </button>
            <button
              type="button"
              className="btn btn-outline btn-block"
              disabled={countdown.running && countdown.remaining > 0}
              onClick={() => void sendCode()}
            >
              {countdown.running && countdown.remaining > 0 ? `${countdown.remaining}s 后可重新发送` : "重新发送验证码"}
            </button>
          </section>
        ) : null}

        {step === "password" ? (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-text">{phase === "first" ? "设置新支付密码" : "再次输入新密码"}</h2>
            <p className="mt-1 text-[11px] text-muted">6 位数字，仅在本机输入，不会显示明文。</p>
            <div className="mt-3">
              <BuiltInKeypad
                title={phase === "first" ? "新支付密码" : "确认新支付密码"}
                description={phase === "first" ? "请输入 6 位数字" : "请再次输入以确认"}
                onSubmit={submitPassword}
                footerExtra={
                  <p className="text-center text-[11px] text-muted">修改成功后动态收付款码会立即失效，并发送邮件提醒。</p>
                }
              />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
