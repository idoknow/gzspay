/** 修改支付密码：邮箱验证码（10 分钟有效、60s 重发、错 5 次锁定）→ 内置键盘两次输入新密码。 */

import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BuiltInKeypad } from "../components/BuiltInKeypad";
import { PageHeader } from "../components/PageHeader";
import { Spinner } from "../components/Loading";
import { useToast } from "../components/Toast";
import { confirmPaymentPasswordReset, startPaymentPasswordReset, verifyPaymentPasswordReset } from "../lib/api";
import { isSixDigitCode } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useCountdown } from "../lib/hooks";
import { useAuth } from "../lib/session";

type Step = "send" | "verify" | "password";

export function ChangePasswordPage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [step, setStep] = useState<Step>("send");
  const [sending, setSending] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"first" | "confirm">("first");
  const [firstPassword, setFirstPassword] = useState<string | null>(null);
  const countdown = useCountdown(60);

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

        {step === "send" ? (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-text">验证邮箱</h2>
            <p className="text-xs leading-relaxed text-muted">
              支付密码用于创建订单与确认交易。修改前需要验证你的登录邮箱，验证码 10 分钟内有效。
            </p>
            <button type="button" className="btn btn-primary btn-block" disabled={sending} onClick={() => void sendCode()}>
              {sending ? <Spinner size={16} /> : null}
              发送验证码
            </button>
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
