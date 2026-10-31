/** 商家中心：渠道启用开关、修改收款码（需支付密码）、商家资料编辑、商品与发布入口。 */

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { Toggle } from "../components/Toggle";
import { useToast } from "../components/Toast";
import { getMerchant, setMerchantChannelEnabled, updateMerchant, uploadMerchantChannelQr } from "../lib/api";
import { cn } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import { useAuth } from "../lib/session";
import type { MerchantChannel, PayChannel } from "../lib/types";

interface QrEditState {
  channel: PayChannel;
  file: File | null;
  previewUrl: string | null;
}

export function MerchantPage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const { me } = useAuth();
  const { data, loading, error, reload } = useAsync(() => getMerchant(), []);
  const [busyChannel, setBusyChannel] = useState<PayChannel | null>(null);
  const [qrEdit, setQrEdit] = useState<QrEditState | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileNote, setProfileNote] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const merchant = data?.registered ? data.merchant : null;

  useEffect(() => {
    return () => {
      if (qrEdit?.previewUrl) URL.revokeObjectURL(qrEdit.previewUrl);
    };
  }, [qrEdit?.previewUrl]);

  const enabledCount = merchant?.channels.filter((item) => item.enabled).length ?? 0;

  const openProfile = (): void => {
    if (!merchant) return;
    setProfileName(merchant.name);
    setProfileNote(merchant.noteRequirement);
    setProfileOpen(true);
  };

  const saveProfile = async (): Promise<void> => {
    const name = profileName.trim();
    if (!name) {
      toast.error("请填写商家名称");
      return;
    }
    setSavingProfile(true);
    try {
      await updateMerchant({ name, noteRequirement: profileNote.trim() });
      toast.success("商家资料已更新");
      setProfileOpen(false);
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleToggle = async (item: MerchantChannel, next: boolean): Promise<void> => {
    if (!next && item.enabled && enabledCount <= 1) {
      toast.error("至少保留一个启用的收款方式");
      return;
    }
    if (next && !item.hasQr) {
      toast.error("请先上传该渠道的收款码");
      return;
    }
    setBusyChannel(item.channel);
    try {
      await setMerchantChannelEnabled(item.channel, next);
      toast.success(next ? `${item.label}收款已启用` : `${item.label}收款已停用`);
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusyChannel(null);
    }
  };

  const closeQrEdit = (): void => {
    if (qrEdit?.previewUrl) URL.revokeObjectURL(qrEdit.previewUrl);
    setQrEdit(null);
    setPasswordOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handlePickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("图片不能超过 5MB");
      return;
    }
    if (qrEdit?.previewUrl) URL.revokeObjectURL(qrEdit.previewUrl);
    setQrEdit({ channel: qrEdit?.channel ?? "alipay", file, previewUrl: URL.createObjectURL(file) });
  };

  const uploadQr = async (password: string): Promise<void> => {
    if (!qrEdit?.file) {
      toast.error("请先选择收款码图片");
      return;
    }
    const form = new FormData();
    form.append("qr", qrEdit.file);
    form.append("paymentPassword", password);
    try {
      await uploadMerchantChannelQr(qrEdit.channel, form);
      toast.success("收款码已更新");
      closeQrEdit();
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
      throw cause;
    }
  };

  if (loading) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="商家中心" back />
        <LoadingBlock text="正在加载商家信息…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="商家中心" back />
        <ErrorBlock message={error} onRetry={reload} />
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="商家中心" back />
        <main className="page pt-4">
          <EmptyState
            title="你还不是商家"
            description="注册商家后可以发布商品、展示收款码，让同学扫码付款。"
            action={
              <button type="button" className="btn btn-primary btn-block" onClick={() => navigate("/merchant/register")}>
                注册成为商家
              </button>
            }
          />
        </main>
      </div>
    );
  }

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="商家中心" back right={<button type="button" className="btn btn-ghost btn-sm" onClick={openProfile}>编辑资料</button>} />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card p-4">
          <div className="flex items-center gap-3">
            <Avatar name={me?.displayName ?? merchant.name} avatarUrl={me?.avatarUrl} size={52} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-text">{merchant.name}</p>
              <p className="mt-0.5 text-xs text-muted">商家账号 · 学号 {me ? me.studentNo : "-"}</p>
            </div>
            <span className="rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-medium text-success">已开通</span>
          </div>
          <div className="mt-3 rounded-2xl bg-surface-2 px-3 py-2.5">
            <p className="text-[11px] text-muted">备注要求</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-text">
              {merchant.noteRequirement || "未设置备注要求（付款人可直接付款）"}
            </p>
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">收款方式</h2>
            <span className="text-[11px] text-muted">至少保留一个启用</span>
          </div>
          <div className="mt-2 space-y-2">
            {merchant.channels.map((item) => (
              <div key={item.channel} className="row rounded-2xl bg-surface-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text">{item.label}</p>
                  <p className={cn("mt-0.5 text-[11px]", item.hasQr ? "text-muted" : "text-danger")}>
                    {item.hasQr ? "已上传收款码" : "未上传收款码，扫码付款时不会展示该渠道"}
                  </p>
                </div>
                <Toggle
                  checked={item.enabled}
                  disabled={busyChannel === item.channel}
                  onChange={(next) => void handleToggle(item, next)}
                  label={`${item.label}收款开关`}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {merchant.channels.map((item) => (
              <button
                key={`qr-${item.channel}`}
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setQrEdit({ channel: item.channel, file: null, previewUrl: null });
                  setPasswordOpen(false);
                }}
              >
                {item.hasQr ? `更换${item.label}收款码` : `上传${item.label}收款码`}
              </button>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <h2 className="text-sm font-semibold text-text">商品与发布</h2>
          <p className="mt-1 text-xs text-muted">维护商品与价格、编辑备注要求、预览付款人视角。</p>
          <button type="button" className="btn btn-primary btn-block mt-3" onClick={() => navigate("/merchant/products")}>
            进入商品与发布
          </button>
        </section>

        <p className="text-center text-[11px] leading-relaxed text-muted">
          资金通过第三方收款码流转，gzspay 不代收代付。
          <br />
          请如实上传本人收款码，谨防账号被他人利用。
        </p>
      </main>

      <Dialog
        open={qrEdit !== null}
        onClose={closeQrEdit}
        title={qrEdit ? `更换${merchant.channels.find((item) => item.channel === qrEdit.channel)?.label ?? ""}收款码` : ""}
        description="上传后由系统识别并校验，失败会提示原因，请重新上传清晰的收款码截图。"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeQrEdit}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!qrEdit?.file}
              onClick={() => setPasswordOpen(true)}
            >
              下一步
            </button>
          </>
        }
      >
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePickFile} />
        <button
          type="button"
          className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-6 text-sm text-muted"
          onClick={() => fileRef.current?.click()}
        >
          {qrEdit?.previewUrl ? (
            <img src={qrEdit.previewUrl} alt="收款码预览" className="mb-2 max-h-52 rounded-xl object-contain" />
          ) : (
            <>
              <span className="text-2xl">＋</span>
              <span className="mt-1">选择收款码图片</span>
            </>
          )}
          {qrEdit?.previewUrl ? <span className="mt-1 text-[11px]">点击重新选择</span> : null}
        </button>
      </Dialog>

      <PaymentPasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="输入支付密码"
        description="修改收款码需要验证支付密码"
        onSubmit={uploadQr}
      />
    </div>
  );
}
