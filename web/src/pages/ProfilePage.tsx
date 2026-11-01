/** 个人信息：资料只读展示，点击对应条目弹出编辑框（姓名 / 学号 / 邮箱 / 校园卡）。 */

import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Dialog } from "../components/Dialog";
import { EyeIcon } from "../components/EyeIcon";
import { PageHeader } from "../components/PageHeader";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { QrScanner } from "../components/QrScanner";
import { Spinner } from "../components/Loading";
import { useToast } from "../components/Toast";
import { bindCard, startEmailChange, updateProfile, verifyEmailChange } from "../lib/api";
import { cn, isEmail, isSixDigitCode, isStudentNo } from "../lib/format";
import { useCountdown, useWatchLayout } from "../lib/hooks";
import { useAuth } from "../lib/session";
import { extractCardContent } from "../lib/scan";

type PendingAction = (password: string) => Promise<void>;
type Tone = "brand" | "accent" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand ring-brand/15",
  accent: "bg-accent-soft text-warning ring-accent/25",
  neutral: "bg-surface-2 text-text ring-line/70",
};

function RowIcon({ tone, children }: { tone: Tone; children: ReactNode }): ReactNode {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 watch:h-8 watch:w-8 watch:rounded-lg",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

function ChevronRightIcon(): ReactNode {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-muted/60"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  );
}

function UserIcon(): ReactNode {
  return (
    <svg className="h-[18px] w-[18px] watch:h-4 watch:w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    </svg>
  );
}

function IdIcon(): ReactNode {
  return (
    <svg className="h-[18px] w-[18px] watch:h-4 watch:w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 10h2.5M7 14h4M14.5 10h2.5M14.5 14h2.5" />
    </svg>
  );
}

function MailIcon(): ReactNode {
  return (
    <svg className="h-[18px] w-[18px] watch:h-4 watch:w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </svg>
  );
}

function CardIcon(): ReactNode {
  return (
    <svg className="h-[18px] w-[18px] watch:h-4 watch:w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M6.5 14.5h3" />
    </svg>
  );
}

function ShieldIcon(): ReactNode {
  return (
    <svg className="h-[18px] w-[18px] watch:h-4 watch:w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 19 6v6c0 4.2-2.9 7.4-7 8.5-4.1-1.1-7-4.3-7-8.5V6l7-2.5Z" />
      <path d="m9.5 12 1.8 1.8L15 10" />
    </svg>
  );
}

function RefreshIcon(): ReactNode {
  return (
    <svg className="h-[18px] w-[18px] watch:h-4 watch:w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.5V9h-4.5" />
    </svg>
  );
}

function ScanIcon(): ReactNode {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M4 12h16" />
    </svg>
  );
}

interface InfoRowProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  trailing?: ReactNode;
  divider?: boolean;
}

/** 一行资料：只显示当前值，需要修改时点击整行进入编辑。 */
function InfoRow({ label, value, hint, icon, tone = "neutral", onClick, trailing, divider }: InfoRowProps): ReactNode {
  const body = (
    <>
      <RowIcon tone={tone}>{icon}</RowIcon>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-muted watch:text-[10px]">{label}</p>
        <div className="mt-0.5 flex items-center gap-2 truncate text-[14px] font-semibold text-text watch:text-[13px]">
          {value}
        </div>
        {hint ? (
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted watch:text-[10px]">{hint}</p>
        ) : null}
      </div>
      {trailing ?? (onClick ? <ChevronRightIcon /> : null)}
    </>
  );

  const base = cn("flex w-full items-center gap-3 px-4 py-3.5 watch:gap-2.5 watch:px-3.5 watch:py-3", divider ? "border-t border-line/60" : "");

  if (!onClick) {
    return <div className={base}>{body}</div>;
  }

  return (
    <button
      type="button"
      className={cn(base, "text-left transition hover:bg-surface-2 active:bg-surface-2")}
      onClick={onClick}
      aria-label={`修改${label}`}
    >
      {body}
    </button>
  );
}

export function ProfilePage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const watch = useWatchLayout();
  const { me, patchMe, refresh } = useAuth();

  const [passwordAction, setPasswordAction] = useState<PendingAction | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /** 当前打开的编辑弹窗 */
  const [nameOpen, setNameOpen] = useState(false);
  const [studentNoOpen, setStudentNoOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  const [nameDraft, setNameDraft] = useState({ surname: "", givenName: "" });
  const [studentNoDraft, setStudentNoDraft] = useState("");

  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStarted, setEmailStarted] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [confirmingEmail, setConfirmingEmail] = useState(false);
  const countdown = useCountdown(60);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [showCardNo, setShowCardNo] = useState(false);

  if (!me) return null;

  const withPassword = (action: PendingAction): void => {
    setPasswordAction(() => action);
  };

  const handlePassword = async (password: string): Promise<void> => {
    if (!passwordAction) return;
    await passwordAction(password);
    setPasswordAction(null);
  };

  const openNameEditor = (): void => {
    setNameDraft({ surname: me.surname ?? "", givenName: me.givenName ?? "" });
    setNameOpen(true);
  };

  const openStudentNoEditor = (): void => {
    setStudentNoDraft(me.studentNo ?? "");
    setStudentNoOpen(true);
  };

  const openEmailEditor = (): void => {
    setEmail("");
    setEmailCode("");
    setEmailStarted(false);
    setDevCode(null);
    countdown.stop();
    setEmailOpen(true);
  };

  const saveName = (): void => {
    const surname = nameDraft.surname.trim();
    const givenName = nameDraft.givenName.trim();
    if (!surname) {
      toast.error("请填写姓");
      return;
    }
    if (!givenName) {
      toast.error("请填写名");
      return;
    }
    setNameOpen(false);
    withPassword(async (password) => {
      setSavingProfile(true);
      try {
        const next = await updateProfile({
          surname,
          givenName,
          studentNo: me.studentNo ?? "",
          paymentPassword: password,
        });
        patchMe(next);
        toast.success("姓名已更新");
      } finally {
        setSavingProfile(false);
      }
    });
  };

  const saveStudentNo = (): void => {
    const studentNo = studentNoDraft.trim();
    if (!isStudentNo(studentNo)) {
      toast.error("学号格式不正确（4-20 位字母或数字）");
      return;
    }
    setStudentNoOpen(false);
    withPassword(async (password) => {
      setSavingProfile(true);
      try {
        const next = await updateProfile({
          surname: me.surname ?? "",
          givenName: me.givenName ?? "",
          studentNo,
          paymentPassword: password,
        });
        patchMe(next);
        toast.success("学号已更新");
      } finally {
        setSavingProfile(false);
      }
    });
  };

  const sendEmailCode = (): void => {
    const target = email.trim();
    if (!isEmail(target)) {
      toast.error("请输入正确的邮箱地址");
      return;
    }
    if (sendingEmail) return;
    setSendingEmail(true);
    withPassword(async (password) => {
      try {
        const result = await startEmailChange({ email: target, paymentPassword: password });
        setEmailStarted(true);
        setDevCode(result.devCode ?? null);
        countdown.restart(60);
        toast.success("验证码已发送，10 分钟内有效");
      } finally {
        setSendingEmail(false);
      }
    });
  };

  const confirmEmail = (): void => {
    const target = email.trim();
    const code = emailCode.trim();
    if (!startedEmail(target)) {
      toast.error("请先获取验证码");
      return;
    }
    if (!isSixDigitCode(code)) {
      toast.error("请输入 6 位验证码");
      return;
    }
    if (confirmingEmail) return;
    setConfirmingEmail(true);
    withPassword(async (password) => {
      try {
        const next = await verifyEmailChange({ email: target, code, paymentPassword: password });
        patchMe(next);
        toast.success("邮箱已更新");
        setEmailOpen(false);
        setEmail("");
        setEmailCode("");
        setEmailStarted(false);
        setDevCode(null);
        countdown.stop();
      } finally {
        setConfirmingEmail(false);
      }
    });
  };

  const startedEmail = (target: string): boolean => emailStarted && isEmail(target);

  const bindWithContent = (content: string): void => {
    withPassword(async (password) => {
      const next = await bindCard({ cardContent: content, paymentPassword: password });
      patchMe(next);
      toast.success("校园卡已换绑");
    });
  };

  const handleScanResult = (raw: string): void => {
    setScannerOpen(false);
    const content = extractCardContent(raw);
    if (!content) {
      toast.error("未识别到校园卡二维码，请重新扫描");
      return;
    }
    bindWithContent(content);
  };

  const handleRefresh = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
      toast.info("资料已刷新");
    } finally {
      setRefreshing(false);
    }
  };

  const cardHint = me.cardNoMasked
    ? "换绑后旧卡将自动解绑，需要验证支付密码。"
    : "还没有绑定校园卡，扫描校园卡上的二维码即可绑定。";

  const chip =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-[color:var(--hero-ring)] bg-[color:var(--hero-chip)] text-[color:var(--hero-fg)] watch:text-[10px]";

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="个人信息" back />

      <main className="page space-y-4 pb-10 pt-4 watch:space-y-3 watch:pt-3">
        <section className="hero-gradient relative overflow-hidden rounded-3xl p-5 watch:rounded-2xl watch:p-3.5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-white/45 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-white/25 blur-2xl"
          />
          <div className="relative flex items-center gap-4 watch:gap-3">
            <Avatar
              name={me.displayName}
              avatarUrl={me.avatarUrl}
              size={watch ? 48 : 64}
              className="ring-1 ring-[color:var(--hero-ring)] shadow-[0_10px_24px_-14px_rgba(0,0,0,0.55)]"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-[color:var(--hero-fg-soft)] watch:text-[10px]">账号资料</p>
              <h1 className="mt-0.5 truncate text-lg font-bold text-[color:var(--hero-fg)] watch:text-[15px]">
                {me.displayName}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 watch:mt-1.5">
                <span className={chip}>{me.frozen ? "已冻结" : "账号正常"}</span>
              </div>
            </div>
          </div>
          <p className="relative mt-4 text-[10.5px] text-[color:var(--hero-fg-faint)] watch:mt-3 watch:text-[9.5px]">
            姓名、学号、邮箱、校园卡都可以点击下面任意一项修改
          </p>
        </section>

        <h2 className="section-title">基本资料</h2>
        <section className="card overflow-hidden p-0">
          <InfoRow
            label="姓名"
            value={me.displayName}
            hint="修改后需要验证支付密码，并同步到校园墙账号。"
            icon={<UserIcon />}
            tone="brand"
            onClick={openNameEditor}
          />
          <InfoRow
            label="校学号"
            value={me.studentNo || "未填写"}
            hint="用于付款人核对身份，可在同学搜索中展示。"
            icon={<IdIcon />}
            tone="accent"
            divider
            onClick={openStudentNoEditor}
          />
          <InfoRow
            label="登录邮箱"
            value={me.emailMasked || "未绑定"}
            hint="更换邮箱需要验证支付密码，验证码 10 分钟内有效。"
            icon={<MailIcon />}
            divider
            onClick={openEmailEditor}
          />
        </section>

        <h2 className="section-title">校园卡</h2>
        <section className="card overflow-hidden p-0">
          <InfoRow
            label="校园卡号"
            value={
              <>
                <span>{me.cardNoMasked ? (showCardNo ? (me.cardNo ?? me.cardNoMasked) : me.cardNoMasked) : "未绑定"}</span>
                {me.cardNoMasked ? (
                  <button
                    type="button"
                    className="grid h-6 w-6 place-items-center rounded-full text-brand transition hover:bg-brand-soft active:scale-90"
                    aria-label={showCardNo ? "隐藏完整卡号" : "显示完整卡号"}
                    aria-pressed={showCardNo}
                    title={showCardNo ? "隐藏完整卡号" : "显示完整卡号"}
                    onClick={() => setShowCardNo((value) => !value)}
                  >
                    <EyeIcon off={showCardNo} size={14} />
                  </button>
                ) : null}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                    me.cardNoMasked
                      ? "bg-success-soft text-success ring-success/20"
                      : "bg-surface-2 text-muted ring-line/70",
                  )}
                >
                  {me.cardNoMasked ? "已绑定" : "未绑定"}
                </span>
              </>
            }
            hint={cardHint}
            icon={<CardIcon />}
            tone="brand"
            trailing={
              <button
                type="button"
                className="btn btn-outline btn-sm shrink-0"
                onClick={() => setCardOpen(true)}
              >
                {me.cardNoMasked ? "换绑" : "绑定"}
              </button>
            }
          />
        </section>

        <h2 className="section-title">账号</h2>
        <section className="card overflow-hidden p-0">
          <InfoRow
            label="登录设备管理"
            value="查看已登录设备与 IP"
            hint="发现陌生设备时可强制退出。"
            icon={<ShieldIcon />}
            tone="neutral"
            onClick={() => navigate("/me/devices")}
          />
          <InfoRow
            label="刷新资料"
            value="重新拉取最新资料"
            hint="刚在其它设备修改过资料时可用。"
            icon={<RefreshIcon />}
            tone="neutral"
            divider
            trailing={
              refreshing ? (
                <Spinner size={16} />
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm shrink-0"
                  onClick={() => {
                    void handleRefresh();
                  }}
                >
                  刷新
                </button>
              )
            }
          />
        </section>
      </main>

      <PaymentPasswordDialog
        open={passwordAction !== null}
        onClose={() => setPasswordAction(null)}
        title="验证支付密码"
        description="该操作需要验证支付密码"
        onSubmit={handlePassword}
      />

      <Dialog
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        title="修改姓名"
        description="修改后需要验证支付密码，并同步到校园墙账号。"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setNameOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={savingProfile} onClick={saveName}>
              {savingProfile ? <Spinner size={16} /> : null}
              保存
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="profile-surname">
              姓
            </label>
            <input
              id="profile-surname"
              className="input"
              value={nameDraft.surname}
              maxLength={10}
              placeholder="例如 陈"
              onChange={(event) => setNameDraft((draft) => ({ ...draft, surname: event.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="profile-given">
              名
            </label>
            <input
              id="profile-given"
              className="input"
              value={nameDraft.givenName}
              maxLength={16}
              placeholder="例如 森林"
              onChange={(event) => setNameDraft((draft) => ({ ...draft, givenName: event.target.value }))}
            />
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
          保存后会显示为「{nameDraft.surname.trim() || "姓"}
          {nameDraft.givenName.trim() || "名"}」，付款人扫码时看到的就是这个名字。
        </p>
      </Dialog>

      <Dialog
        open={studentNoOpen}
        onClose={() => setStudentNoOpen(false)}
        title="修改学号"
        description="修改后需要验证支付密码，并同步到校园墙账号。"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setStudentNoOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={savingProfile} onClick={saveStudentNo}>
              {savingProfile ? <Spinner size={16} /> : null}
              保存
            </button>
          </>
        }
      >
        <label className="label" htmlFor="profile-student-no">
          校学号
        </label>
        <input
          id="profile-student-no"
          className="input"
          value={studentNoDraft}
          maxLength={20}
          autoCapitalize="characters"
          placeholder="请输入校学号"
          onChange={(event) => setStudentNoDraft(event.target.value)}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-muted">4-20 位字母或数字，例如 26910513。</p>
      </Dialog>

      <Dialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title="更换登录邮箱"
        description="需要验证支付密码，验证码 10 分钟内有效。"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEmailOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={confirmingEmail}
              onClick={confirmEmail}
            >
              {confirmingEmail ? <Spinner size={16} /> : null}
              验证并更换
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
            <span className="text-[11px] text-muted">当前邮箱</span>
            <span className="text-[12px] font-medium text-text">{me.emailMasked || "未绑定"}</span>
          </div>
          <div>
            <label className="label" htmlFor="profile-email">
              新邮箱
            </label>
            <input
              id="profile-email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              placeholder="name@example.com"
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailStarted(false);
                setEmailCode("");
                countdown.stop();
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="profile-email-code">
              验证码
            </label>
            <div className="flex gap-2">
              <input
                id="profile-email-code"
                className="input flex-1"
                inputMode="numeric"
                maxLength={6}
                placeholder="6 位验证码"
                value={emailCode}
                onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))}
              />
              <button
                type="button"
                className="btn btn-outline shrink-0"
                disabled={sendingEmail || (countdown.running && countdown.remaining > 0)}
                onClick={sendEmailCode}
              >
                {sendingEmail ? (
                  <Spinner size={16} />
                ) : countdown.running && countdown.remaining > 0 ? (
                  `${countdown.remaining}s`
                ) : emailStarted ? (
                  "重新发送"
                ) : (
                  "获取验证码"
                )}
              </button>
            </div>
          </div>
          {devCode ? (
            <p className="rounded-xl bg-accent-soft px-3 py-2 text-[11px] text-warning">开发环境验证码：{devCode}</p>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted">验证码会发送到新邮箱，验证通过后才会替换当前邮箱。</p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        title={me.cardNoMasked ? "换绑校园卡" : "绑定校园卡"}
        description={cardHint}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
            <RowIcon tone={me.cardNoMasked ? "brand" : "neutral"}>
              <CardIcon />
            </RowIcon>
            <div className="min-w-0">
              <p className="text-[11px] text-muted">当前校园卡</p>
              <p className="truncate text-[13px] font-semibold text-text">
                {me.cardNoMasked ? me.cardNoMasked : "尚未绑定"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              setCardOpen(false);
              setScannerOpen(true);
            }}
          >
            <ScanIcon />
            扫描校园卡二维码
          </button>
          <p className="text-center text-[11px] leading-relaxed text-muted">
            绑定校园卡只支持摄像头扫码，不能手动输入或从相册选择。
          </p>
        </div>
      </Dialog>

      <QrScanner
        open={scannerOpen}
        title="扫描校园卡二维码"
        hint="将校园卡二维码放入取景框内"
        scanOnly
        manualLabel="校园卡卡号"
        manualPlaceholder="例如 2023123456"
        onResult={handleScanResult}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}
