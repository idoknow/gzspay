/** 新用户引导：姓名 → 学号 → 邮箱验证码 → 绑定校园卡 → 设置支付密码。每步一页、可返回、有进度指示。 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BuiltInKeypad } from "../components/BuiltInKeypad";
import { LoadingBlock } from "../components/Loading";
import { Logo } from "../components/Logo";
import { QrScanner } from "../components/QrScanner";
import { Spinner } from "../components/Loading";
import { useToast } from "../components/Toast";
import {
  getOnboarding,
  startOnboardingEmail,
  submitOnboardingCard,
  submitOnboardingName,
  submitOnboardingPassword,
  submitOnboardingStudentNo,
  verifyOnboardingEmail,
} from "../lib/api";
import { errorMessage } from "../lib/http";
import { isQqEmail, isSixDigitCode, isStudentNo } from "../lib/format";
import { useCountdown, useAsync } from "../lib/hooks";
import { extractCardContent } from "../lib/scan";
import { useAuth } from "../lib/session";
import type { Me, OnboardStep, OnboardingResponse } from "../lib/types";

const FALLBACK_STEPS: OnboardStep[] = ["name", "studentNo", "email", "card", "password"];

const STEP_LABELS: Record<Exclude<OnboardStep, "done">, string> = {
  name: "姓名",
  studentNo: "学号",
  email: "邮箱",
  card: "校园卡",
  password: "支付密码",
};

const STEP_TITLES: Record<Exclude<OnboardStep, "done">, string> = {
  name: "你叫什么名字？",
  studentNo: "填写校学号",
  email: "绑定邮箱",
  card: "绑定校园卡",
  password: "设置支付密码",
};

interface StepProps {
  me: Me | null;
  onDone: (result: OnboardingResponse) => void;
}

function StepShell({ title, description, children }: { title: string; description: string; children: ReactNode }): ReactNode {
  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-text">{title}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p>
      <div className="mt-6 space-y-5">{children}</div>
    </div>
  );
}

/* ------------------------------ 姓名 ------------------------------ */

function NameStep({ me, onDone }: StepProps): ReactNode {
  const toast = useToast();
  const [surname, setSurname] = useState(me?.surname ?? "");
  const [givenName, setGivenName] = useState(me?.givenName ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const surnameText = surname.trim();
    const givenNameText = givenName.trim();
    if (!surnameText || !givenNameText) {
      toast.error("请填写真实姓名（姓、名都要填写）");
      return;
    }
    setBusy(true);
    try {
      onDone(await submitOnboardingName({ surname: surnameText, givenName: givenNameText }));
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell title={STEP_TITLES.name} description="请填写真实姓名，便于交易双方核对身份。">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className="label" htmlFor="surname">
            姓
          </label>
          <input
            id="surname"
            className="input"
            value={surname}
            maxLength={20}
            autoComplete="off"
            placeholder="例如：张"
            onChange={(event) => setSurname(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="givenName">
            名
          </label>
          <input
            id="givenName"
            className="input"
            value={givenName}
            maxLength={20}
            autoComplete="off"
            placeholder="例如：小明"
            onChange={(event) => setGivenName(event.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner size={18} /> : null}
          下一步
        </button>
      </form>
    </StepShell>
  );
}

/* ------------------------------ 学号 ------------------------------ */

function StudentNoStep({ me, onDone }: StepProps): ReactNode {
  const toast = useToast();
  const [studentNo, setStudentNo] = useState(me?.studentNo ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const value = studentNo.trim();
    if (!isStudentNo(value)) {
      toast.error("请输入正确的校学号（字母或数字，4-20 位）");
      return;
    }
    setBusy(true);
    try {
      onDone(await submitOnboardingStudentNo({ studentNo: value }));
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell title={STEP_TITLES.studentNo} description="校学号唯一，将用于校园卡绑定与支付信息展示。">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className="label" htmlFor="studentNo">
            校学号
          </label>
          <input
            id="studentNo"
            className="input text-amount tracking-wide"
            value={studentNo}
            maxLength={20}
            autoComplete="off"
            inputMode="text"
            placeholder="请输入校学号"
            onChange={(event) => setStudentNo(event.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner size={18} /> : null}
          下一步
        </button>
      </form>
    </StepShell>
  );
}

/* ------------------------------ 邮箱 ------------------------------ */

function EmailStep({ me, onDone }: StepProps): ReactNode {
  const toast = useToast();
  const [email, setEmail] = useState(me?.email ?? "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const countdown = useCountdown(60);

  const sendCode = async (): Promise<void> => {
    if (sending) return;
    if (!isQqEmail(email)) {
      toast.error("请输入 QQ 邮箱，格式为 QQ号@qq.com（QQ 号需为纯数字）");
      return;
    }
    setSending(true);
    try {
      const result = await startOnboardingEmail(email.trim());
      setSent(true);
      setDevCode(result.devCode ?? null);
      countdown.restart(60);
      toast.success("验证码已发送，请查收邮箱");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSending(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (!isQqEmail(email)) {
      toast.error("请输入 QQ 邮箱，格式为 QQ号@qq.com（QQ 号需为纯数字）");
      return;
    }
    if (!isSixDigitCode(code)) {
      toast.error("请输入 6 位数字验证码");
      return;
    }
    setBusy(true);
    try {
      onDone(await verifyOnboardingEmail({ email: email.trim(), code }));
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell
      title={STEP_TITLES.email}
      description="绑定 QQ 邮箱用于找回支付密码和接收交易通知：@qq.com 前填纯数字 QQ 号。验证码 10 分钟内有效。"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className="label" htmlFor="email">
            邮箱
          </label>
          <div className="flex gap-2">
            <input
              id="email"
              className="input flex-1"
              value={email}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="QQ号@qq.com"
              onChange={(event) => setEmail(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-outline shrink-0 px-3.5 text-sm"
              disabled={sending || countdown.remaining > 0}
              onClick={() => void sendCode()}
            >
              {sending ? <Spinner size={16} /> : null}
              {countdown.remaining > 0 ? `${countdown.remaining}s 后重发` : sent ? "重新发送" : "发送验证码"}
            </button>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="emailCode">
            邮箱验证码
          </label>
          <input
            id="emailCode"
            className="input text-amount tracking-[0.4em]"
            value={code}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6 位验证码"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          {devCode ? <p className="mt-2 text-xs text-warning">开发环境验证码：{devCode}</p> : null}
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? <Spinner size={18} /> : null}
          下一步
        </button>
      </form>
    </StepShell>
  );
}

/* ------------------------------ 校园卡 ------------------------------ */

function CardStep({ me, onDone }: StepProps): ReactNode {
  const toast = useToast();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const submitCard = useCallback(
    async (cardContent: string): Promise<void> => {
      setBusy(true);
      try {
        onDone(await submitOnboardingCard({ cardContent }));
      } catch (cause) {
        toast.error(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [onDone, toast],
  );

  const handleScan = (raw: string): void => {
    setScannerOpen(false);
    const content = extractCardContent(raw);
    if (!content) {
      toast.error("未识别到校园卡二维码，请重新扫描");
      return;
    }
    void submitCard(raw.trim());
  };

  return (
    <StepShell title={STEP_TITLES.card} description="校园卡只用于识别身份，不会用于扣款。">
      {me?.cardNoMasked ? (
        <p className="rounded-2xl bg-success-soft px-4 py-3 text-sm text-success">当前已绑定校园卡：{me.cardNoMasked}</p>
      ) : null}

      <div className="card p-5">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M7 9h5M7 13h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="17" cy="14" r="2.2" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </span>
          <p className="mt-3 text-sm font-semibold text-text">将校园卡二维码放入取景框</p>
          <p className="mt-1 text-xs text-muted">绑定校园卡只支持摄像头扫码，不能手动输入或从相册选择</p>
          <button
            type="button"
            className="btn btn-primary btn-block mt-4"
            disabled={busy}
            onClick={() => setScannerOpen(true)}
          >
            {busy ? <Spinner size={18} /> : null}
            扫描校园卡
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">
          相机无法使用？请在系统浏览器（Safari / Chrome）中打开本页，并允许使用摄像头。
        </p>
      </div>

      <QrScanner
        open={scannerOpen}
        title="扫描校园卡二维码"
        hint="将校园卡二维码放入取景框，即可自动识别"
        scanOnly
        manualLabel="校园卡卡号"
        manualPlaceholder="例如 2023123456"
        onResult={handleScan}
        onClose={() => setScannerOpen(false)}
      />
    </StepShell>
  );
}

/* ------------------------------ 支付密码 ------------------------------ */

function PasswordStep({ onDone }: StepProps): ReactNode {
  const toast = useToast();
  const [phase, setPhase] = useState<"first" | "confirm">("first");
  const [first, setFirst] = useState("");

  const submit = async (value: string): Promise<void> => {
    if (phase === "first") {
      setFirst(value);
      setPhase("confirm");
      return;
    }
    if (value !== first) {
      setFirst("");
      setPhase("first");
      throw new Error("两次输入的密码不一致，请重新设置");
    }
    try {
      onDone(await submitOnboardingPassword({ password: value, confirm: value }));
    } catch (cause) {
      setFirst("");
      setPhase("first");
      toast.error(errorMessage(cause));
      throw cause;
    }
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-text">{STEP_TITLES.password}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        支付密码为 6 位数字，用于确认付款等操作。请勿告诉他人，gzspay 工作人员不会向你索取。
      </p>
      <div className="mt-6">
        <BuiltInKeypad
          title={phase === "first" ? "设置支付密码" : "再次输入以确认"}
          description={phase === "first" ? "请输入 6 位数字支付密码" : "请再次输入相同的 6 位密码"}
          length={6}
          onSubmit={submit}
          footerExtra={
            phase === "confirm" ? (
              <button
                type="button"
                className="text-xs font-medium text-brand"
                onClick={() => {
                  setFirst("");
                  setPhase("first");
                }}
              >
                重新设置密码
              </button>
            ) : null
          }
        />
      </div>
    </div>
  );
}

/* ------------------------------ 页面 ------------------------------ */

export function OnboardingPage(): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const { me, updateMe } = useAuth();
  const { data, loading, error, reload } = useAsync(() => getOnboarding(), []);
  const [step, setStep] = useState<OnboardStep | null>(null);

  const currentMe = me ?? data?.me ?? null;

  const flowSteps = useMemo<OnboardStep[]>(() => {
    const list = (data?.steps ?? []).filter((item): item is Exclude<OnboardStep, "done"> => item !== "done");
    return list.length > 0 ? list : FALLBACK_STEPS;
  }, [data]);

  const currentStep: OnboardStep = step ?? data?.step ?? "name";
  const currentIndex = Math.max(0, flowSteps.indexOf(currentStep));

  useEffect(() => {
    if (!data) return;
    setStep((previous) => previous ?? data.step);
  }, [data]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [currentStep]);

  useEffect(() => {
    if (currentStep === "done" || (currentMe?.onboarded && step === null)) {
      navigate("/trades", { replace: true });
    }
  }, [currentStep, currentMe?.onboarded, step, navigate]);

  const handleDone = useCallback(
    (result: OnboardingResponse) => {
      updateMe(result.me);
      if (result.step === "done" || result.me.onboarded) {
        toast.success("资料已完成，欢迎使用 gzspay");
        navigate("/trades", { replace: true });
        return;
      }
      setStep(result.step);
    },
    [navigate, toast, updateMe],
  );

  const goBack = (): void => {
    if (currentIndex <= 0) return;
    const previous = flowSteps[currentIndex - 1];
    if (previous) setStep(previous);
  };

  if (loading && !data) {
    return (
      <div className="bg-app flex min-h-[100dvh] items-center justify-center px-6">
        <LoadingBlock text="正在读取引导进度…" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-app flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-danger">{error ?? "引导信息加载失败"}</p>
        <button type="button" className="btn btn-primary" onClick={reload}>
          重试
        </button>
      </div>
    );
  }

  let stepContent: ReactNode = null;
  if (currentStep === "name") stepContent = <NameStep me={currentMe} onDone={handleDone} />;
  else if (currentStep === "studentNo") stepContent = <StudentNoStep me={currentMe} onDone={handleDone} />;
  else if (currentStep === "email") stepContent = <EmailStep me={currentMe} onDone={handleDone} />;
  else if (currentStep === "card") stepContent = <CardStep me={currentMe} onDone={handleDone} />;
  else if (currentStep === "password") stepContent = <PasswordStep me={currentMe} onDone={handleDone} />;

  return (
    <div className="bg-app min-h-[100dvh]">
      <header className="sticky top-0 z-30 border-b border-line glass safe-top">
        <div className="page flex items-center gap-2 py-3">
          {currentIndex > 0 ? (
            <button
              type="button"
              aria-label="返回上一步"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text active:bg-surface-2"
              onClick={goBack}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <span className="h-9 w-9" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text">完善个人资料</p>
            <p className="text-[11px] text-muted">
              第 {(currentIndex + 1) || 1} / {flowSteps.length} 步 · {STEP_LABELS[(currentStep === "done" ? "name" : currentStep)]}
            </p>
          </div>
          <Logo size={30} />
        </div>
        <div className="page flex gap-1.5 pb-3">
          {flowSteps.map((item, index) => (
            <span
              key={item}
              className={`h-1.5 flex-1 rounded-full transition-colors ${index <= currentIndex ? "bg-brand" : "bg-surface-2"}`}
            />
          ))}
        </div>
      </header>

      <main className="page pb-[calc(40px+env(safe-area-inset-bottom))] pt-6">{stepContent}</main>
    </div>
  );
}
