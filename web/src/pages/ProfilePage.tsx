/** 个人信息：各项资料只读展示，点击对应条目弹出编辑框（姓名 / 学号 / 邮箱 / 校园卡）。 */

import { useState, type ReactNode } from "react";
import { Dialog } from "../components/Dialog";
import { EyeIcon } from "../components/EyeIcon";
import { PageHeader } from "../components/PageHeader";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { QrScanner } from "../components/QrScanner";
import { Spinner } from "../components/Loading";
import { useToast } from "../components/Toast";
import { bindCard, startEmailChange, updateProfile, verifyEmailChange } from "../lib/api";
import { isEmail, isSixDigitCode, isStudentNo } from "../lib/format";
import { useCountdown } from "../lib/hooks";
import { useAuth } from "../lib/session";
import { CARD_PREFIX, extractCardContent } from "../lib/scan";

type PendingAction = (password: string) => Promise<void>;

function ChevronRightIcon(): ReactNode {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-muted"
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

interface InfoRowProps {
  label: string;
  value: ReactNode;
  hint?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}

/** 一行资料：只显示当前值，需要修改时点击整行进入编辑。 */
function InfoRow({ label, value, hint, onClick, trailing }: InfoRowProps): ReactNode {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted">{label}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[13.5px] font-medium text-text">{value}</div>
        {hint ? <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">{hint}</p> : null}
      </div>
      {trailing ?? (onClick ? <ChevronRightIcon /> : null)}
    </>
  );

  if (!onClick) {
    return <div className="flex w-full items-center gap-3 px-4 py-3">{body}</div>;
  }

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-surface-2"
      onClick={onClick}
      aria-label={`修改${label}`}
    >
      {body}
    </button>
  );
}

export function ProfilePage(): ReactNode {
  const toast = useToast();
  const { me, patchMe, refresh } = useAuth();

  const [passwordAction, setPasswordAction] = useState<PendingAction | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

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
  const countdown = useCountdown(60);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualCardOpen, setManualCardOpen] = useState(false);
  const [manualCard, setManualCard] = useState("");
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
    withPassword(async (password) => {
      const result = await startEmailChange({ email: target, paymentPassword: password });
      setEmailStarted(true);
      setDevCode(result.devCode ?? null);
      countdown.restart(60);
      toast.success("验证码已发送，10 分钟内有效");
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
    withPassword(async (password) => {
      const next = await verifyEmailChange({ email: target, code, paymentPassword: password });
      patchMe(next);
      toast.success("邮箱已更新");
      setEmailOpen(false);
      setEmail("");
      setEmailCode("");
      setEmailStarted(false);
      setDevCode(null);
      countdown.stop();
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
      toast.error("未识别到校园卡信息，请重试或手动输入卡号");
      return;
    }
    bindWithContent(content);
  };

  const handleManualCard = (): void => {
    const value = manualCard.trim();
    if (!value) {
      toast.error("请输入校园卡号");
      return;
    }
    setManualCardOpen(false);
    bindWithContent(value.startsWith(CARD_PREFIX) ? value : `${CARD_PREFIX}${value}`);
  };

  const cardHint = me.cardNoMasked ? "换绑后旧卡将自动解绑，需要验证支付密码。" : "还没有绑定校园卡，扫码或手动输入卡号即可绑定。";

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="个人信息" back />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card overflow-hidden p-0">
          <InfoRow
            label="姓名"
            value={me.displayName}
            hint="修改后需要验证支付密码，并同步到校园墙账号。"
            onClick={openNameEditor}
          />
          <div className="h-px bg-line/70" />
          <InfoRow
            label="校学号"
            value={me.studentNo || "未填写"}
            onClick={openStudentNoEditor}
          />
          <div className="h-px bg-line/70" />
          <InfoRow
            label="登录邮箱"
            value={me.emailMasked || "未绑定"}
            hint="更换邮箱需要验证支付密码，验证码 10 分钟内有效。"
            onClick={openEmailEditor}
          />
        </section>

        <section className="card overflow-hidden p-0">
          <InfoRow
            label="校园卡"
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
              </>
            }
            hint={cardHint}
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

        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => {
            void refresh();
            toast.info("资料已刷新");
          }}
        >
          刷新资料
        </button>
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
              onChange={(event) => setNameDraft((draft) => ({ ...draft, givenName: event.target.value }))}
            />
          </div>
        </div>
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
            <button type="button" className="btn btn-primary" onClick={confirmEmail}>
              验证并更换
            </button>
          </>
        }
      >
        <div className="space-y-3">
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
          <div className="flex gap-2">
            <input
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
              disabled={countdown.running && countdown.remaining > 0}
              onClick={sendEmailCode}
            >
              {countdown.running && countdown.remaining > 0
                ? `${countdown.remaining}s`
                : emailStarted
                  ? "重新发送"
                  : "获取验证码"}
            </button>
          </div>
          {devCode ? <p className="text-[11px] text-accent-strong">开发环境验证码：{devCode}</p> : null}
        </div>
      </Dialog>

      <Dialog
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        title={me.cardNoMasked ? "换绑校园卡" : "绑定校园卡"}
        description={cardHint}
      >
        <div className="space-y-2">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              setCardOpen(false);
              setScannerOpen(true);
            }}
          >
            扫码{me.cardNoMasked ? "换绑" : "绑定"}校园卡
          </button>
          <button
            type="button"
            className="btn btn-outline btn-block"
            onClick={() => {
              setCardOpen(false);
              setManualCardOpen(true);
            }}
          >
            手动输入卡号
          </button>
        </div>
      </Dialog>

      <QrScanner
        open={scannerOpen}
        title="扫描校园卡二维码"
        hint="将校园卡二维码放入取景框内"
        manualLabel="校园卡卡号"
        manualPlaceholder="例如 2023123456"
        onResult={handleScanResult}
        onClose={() => setScannerOpen(false)}
      />

      <Dialog
        open={manualCardOpen}
        onClose={() => setManualCardOpen(false)}
        title="手动输入卡号"
        description="输入校园卡上的卡号即可换绑"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setManualCardOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={handleManualCard}>
              下一步
            </button>
          </>
        }
      >
        <input
          className="input"
          value={manualCard}
          placeholder="请输入校园卡号"
          onChange={(event) => setManualCard(event.target.value)}
        />
      </Dialog>
    </div>
  );
}
