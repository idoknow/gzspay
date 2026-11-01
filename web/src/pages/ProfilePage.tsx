/** 个人信息：修改姓名/学号（需支付密码）、更换邮箱（支付密码 + 验证码）、换绑校园卡。 */

import { useState, type ReactNode } from "react";
import { Dialog } from "../components/Dialog";
import { PageHeader } from "../components/PageHeader";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { QrScanner } from "../components/QrScanner";
import { Spinner } from "../components/Loading";
import { useToast } from "../components/Toast";
import { bindCard, startEmailChange, updateProfile, verifyEmailChange } from "../lib/api";
import { isEmail, isSixDigitCode, isStudentNo } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useCountdown } from "../lib/hooks";
import { useAuth } from "../lib/session";
import { CARD_PREFIX, extractCardContent } from "../lib/scan";

type PendingAction = (password: string) => Promise<void>;

export function ProfilePage(): ReactNode {
  const toast = useToast();
  const { me, patchMe, refresh } = useAuth();
  const [surname, setSurname] = useState(me?.surname ?? "");
  const [givenName, setGivenName] = useState(me?.givenName ?? "");
  const [studentNo, setStudentNo] = useState(me?.studentNo ?? "");

  const [passwordAction, setPasswordAction] = useState<PendingAction | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

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

  const saveProfile = (): void => {
    const finalSurname = surname.trim();
    const finalGivenName = givenName.trim();
    const finalStudentNo = studentNo.trim();
    if (!finalSurname) {
      toast.error("请填写姓");
      return;
    }
    if (!finalGivenName) {
      toast.error("请填写名");
      return;
    }
    if (!isStudentNo(finalStudentNo)) {
      toast.error("学号格式不正确（4-20 位字母或数字）");
      return;
    }
    withPassword(async (password) => {
      setSavingProfile(true);
      try {
        const next = await updateProfile({ surname: finalSurname, givenName: finalGivenName, studentNo: finalStudentNo, paymentPassword: password });
        patchMe(next);
        toast.success("个人信息已更新");
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
      try {
        const next = await bindCard({ cardContent: content, paymentPassword: password });
        patchMe(next);
        toast.success("校园卡已换绑");
      } catch (cause) {
        throw cause;
      }
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

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="个人信息" back />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-text">基本信息</h2>
          <p className="text-[11px] text-muted">修改姓名或学号需要验证支付密码，修改后会同步到校园墙账号。</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="profile-surname">
                姓
              </label>
              <input id="profile-surname" className="input" value={surname} maxLength={10} onChange={(event) => setSurname(event.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="profile-given">
                名
              </label>
              <input id="profile-given" className="input" value={givenName} maxLength={16} onChange={(event) => setGivenName(event.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="profile-student-no">
              校学号
            </label>
            <input
              id="profile-student-no"
              className="input"
              value={studentNo}
              maxLength={20}
              autoCapitalize="characters"
              onChange={(event) => setStudentNo(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">当前：{me.studentNo}</p>
          </div>
          <button type="button" className="btn btn-primary btn-block" disabled={savingProfile} onClick={saveProfile}>
            {savingProfile ? <Spinner size={16} /> : null}
            保存基本信息
          </button>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-text">登录邮箱</h2>
          <p className="text-[11px] text-muted">当前邮箱：{me.emailMasked || "未绑定"}</p>
          <p className="text-[11px] text-muted">更换邮箱需要验证支付密码，验证码 10 分钟内有效。</p>
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
              {countdown.running && countdown.remaining > 0 ? `${countdown.remaining}s` : emailStarted ? "重新发送" : "获取验证码"}
            </button>
          </div>
          {devCode ? <p className="text-[11px] text-accent-strong">开发环境验证码：{devCode}</p> : null}
          <button type="button" className="btn btn-secondary btn-block" onClick={confirmEmail}>
            验证并更换邮箱
          </button>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-text">校园卡</h2>
          <p className="text-[11px] text-muted">
            当前校园卡：
            <button
              type="button"
              className="text-brand"
              onClick={() => setShowCardNo((value) => !value)}
            >
              {me.cardNoMasked ? (showCardNo ? (me.cardNo ?? me.cardNoMasked) : me.cardNoMasked) : "未绑定"}
              {me.cardNoMasked ? (showCardNo ? "（隐藏）" : "（显示）") : ""}
            </button>
          </p>
          <p className="text-[11px] text-muted">换绑后旧卡将自动解绑，需要验证支付密码。</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setScannerOpen(true)}>
            扫码换绑校园卡
          </button>
          <button type="button" className="btn btn-outline btn-block" onClick={() => setManualCardOpen(true)}>
            手动输入卡号
          </button>
        </section>

        <button type="button" className="btn btn-ghost btn-block" onClick={() => { void refresh(); toast.info("资料已刷新"); }}>
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
