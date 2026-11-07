/** 商家中心：商家资料与备注要求、收款方式开关与收款码、商品与发布入口。 */

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { ChannelIcon } from "../components/ChannelIcon";
import { useContextMenus, useCopy, type ContextMenuItem } from "../components/ContextMenu";
import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  EyeOffSafeIcon,
  OpenIcon,
  RefreshIcon as MenuRefreshIcon,
} from "../components/ContextMenuIcons";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { EyeIcon } from "../components/EyeIcon";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { QrImage, useBlobUrl } from "../components/QrImage";
import { Toggle } from "../components/Toggle";
import { useToast } from "../components/Toast";
import {
  getMerchant,
  getMerchantChannelQrBlob,
  setMerchantChannelEnabled,
  updateMerchant,
  uploadMerchantChannelQr,
} from "../lib/api";
import { cn } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAsync, useWatchLayout } from "../lib/hooks";
import { useAuth } from "../lib/session";
import type { MerchantChannel, PayChannel } from "../lib/types";

interface QrEditState {
  channel: PayChannel;
  file: File | null;
  previewUrl: string | null;
}

/** 渠道标识使用官方图标（支付宝 / 微信支付 / QQ 钱包），让三行收款方式更容易区分。 */

/** 更换收款码：环形箭头。 */
function RefreshIcon(): ReactNode {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11.5a8 8 0 1 0-2.6 6.1" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

/** 上传收款码：向上箭头 + 托盘。 */
function UploadIcon(): ReactNode {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4.6" />
      <path d="m7.6 8.8 4.4-4.2 4.4 4.2" />
      <path d="M4.6 15.4v2.8a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8v-2.8" />
    </svg>
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  tone?: "default" | "brand";
}

/** 收款方式行内的图标按钮：文字说明放到 aria-label / title，界面只留图标。 */
function IconButton({ label, onClick, children, tone = "default" }: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition active:scale-95 watch:h-7.5 watch:w-7.5",
        tone === "brand"
          ? "border-brand/30 bg-brand-soft text-brand hover:border-brand/50"
          : "border-line/70 bg-surface text-muted hover:border-line hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

export function MerchantPage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const watch = useWatchLayout();
  const { me } = useAuth();
  const { data, loading, error, reload } = useAsync(() => getMerchant(), []);
  const [busyChannel, setBusyChannel] = useState<PayChannel | null>(null);
  const [qrEdit, setQrEdit] = useState<QrEditState | null>(null);
  const [qrView, setQrView] = useState<PayChannel | null>(null);
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
  const qrViewLabel = qrView ? (merchant?.channels.find((item) => item.channel === qrView)?.label ?? "") : "";
  const qrViewBlob = useBlobUrl(qrView ? () => getMerchantChannelQrBlob(qrView) : null, [qrView ?? ""]);

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

  const openQrEdit = (channel: PayChannel): void => {
    setQrEdit({ channel, file: null, previewUrl: null });
    setPasswordOpen(false);
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

  const copy = useCopy();

  /** 收款方式图标按钮组：查看 / 更换 / 上传收款码 */
  const channelMenu = (element: HTMLElement): ContextMenuItem[] | null => {
    const channel = element.dataset.menuId as PayChannel | undefined;
    const item = merchant?.channels.find((entry) => entry.channel === channel);
    if (!item) return null;
    if (!item.hasQr) {
      return [
        {
          label: "上传收款码",
          hint: item.label,
          icon: <ArrowRightIcon />,
          onSelect: () => openQrEdit(item.channel),
        },
        {
          label: "查看收款码",
          hint: "未上传",
          icon: <OpenIcon />,
          disabled: true,
          onSelect: () => setQrView(item.channel),
        },
      ];
    }
    return [
      {
        label: "查看收款码",
        hint: item.label,
        icon: <OpenIcon />,
        onSelect: () => setQrView(item.channel),
      },
      {
        label: "更换收款码",
        hint: item.label,
        icon: <MenuRefreshIcon />,
        onSelect: () => openQrEdit(item.channel),
      },
    ];
  };

  /** 收款方式开关：启用 / 停用该渠道（停用沿用原有校验，至少保留一个） */
  const switchMenu = (element: HTMLElement): ContextMenuItem[] | null => {
    const channel = element.dataset.menuId as PayChannel | undefined;
    const item = merchant?.channels.find((entry) => entry.channel === channel);
    if (!item) return null;
    const busy = busyChannel === item.channel;
    return [
      {
        label: "启用该渠道",
        hint: item.hasQr ? item.label : "需先上传收款码",
        icon: <CheckIcon />,
        disabled: busy || item.enabled || !item.hasQr,
        onSelect: () => void handleToggle(item, true),
      },
      {
        label: "停用该渠道",
        hint: enabledCount <= 1 ? "至少保留一个" : item.label,
        icon: <EyeOffSafeIcon />,
        danger: true,
        disabled: busy || !item.enabled || enabledCount <= 1,
        onSelect: () => void handleToggle(item, false),
      },
    ];
  };

  /** 商品与发布入口：打开商品管理 / 复制商家名称 */
  const productsMenu = (): ContextMenuItem[] | null => {
    if (!merchant) return null;
    return [
      {
        label: "打开商品管理",
        icon: <OpenIcon />,
        onSelect: () => navigate("/merchant/products"),
      },
      {
        label: "复制商家名称",
        hint: merchant.name,
        icon: <CopyIcon />,
        onSelect: () => void copy(merchant.name, "商家名称"),
      },
    ];
  };

  useContextMenus({
    "merchant.channel": channelMenu,
    "merchant.switch": switchMenu,
    "merchant.products": productsMenu,
  });

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
            description="注册后可发布商品并展示收款码。"
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
      <PageHeader title="商家中心" back />

      <main className="page space-y-3.5 pb-10 pt-4 watch:space-y-2.5">
        {/* 商家概览：头像、名称、学号与两个快捷入口 */}
        <section className="hero-gradient relative overflow-hidden rounded-[26px] p-4 shadow-[var(--shadow-card)] watch:rounded-2xl watch:p-3.5">
          <span aria-hidden="true" className="absolute -top-14 -right-10 h-32 w-32 rounded-full bg-white/30" />
          <span aria-hidden="true" className="absolute -bottom-16 -left-8 h-28 w-28 rounded-full bg-white/20" />
          <div className="relative flex items-start gap-3">
            <Avatar
              name={me?.displayName ?? merchant.name}
              avatarUrl={me?.avatarUrl}
              size={watch ? 46 : 54}
              className="ring-2 ring-white/45"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[17px] font-semibold text-[color:var(--hero-fg)] watch:text-[15px]">
                  {merchant.name}
                </p>
                <span className="shrink-0 rounded-full bg-[color:var(--hero-chip)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--hero-fg)]">
                  已开通
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-[color:var(--hero-fg-soft)]">
                商家账号 · 学号 {me?.studentNo || "未填写"}
              </p>
            </div>
          </div>

          <div className="relative mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-[color:var(--hero-chip)] px-3 py-2">
              <p className="text-[10px] text-[color:var(--hero-fg-faint)]">收款方式</p>
              <p className="mt-0.5 text-[13px] font-semibold text-[color:var(--hero-fg)]">
                {enabledCount} / {merchant.channels.length} 已启用
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/merchant/products")}
              className="flex items-center justify-between gap-1 rounded-2xl bg-[color:var(--hero-chip)] px-3 py-2 text-left transition active:scale-[0.98]"
            >
              <span>
                <span className="block text-[10px] text-[color:var(--hero-fg-faint)]">商品与发布</span>
                <span className="mt-0.5 block text-[13px] font-semibold text-[color:var(--hero-fg)]">管理商品</span>
              </span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-[color:var(--hero-fg-soft)]" />
            </button>
          </div>
        </section>

        {/* 发起收款：先定好金额/商品，付款人扫商家校园卡二维码即可直接付款 */}
        <section className="card flex items-center gap-3 p-4 watch:rounded-2xl watch:p-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text">发起收款</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              填好金额，对方扫你的码付款。
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/merchant/collect")}
            className="btn btn-primary btn-sm shrink-0"
          >
            去发起
          </button>
        </section>

        {/* 备注要求 */}
        <section className="card p-4 watch:rounded-2xl watch:p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted watch:h-6 watch:w-6">
                <NoteIcon />
              </span>
              <h2 className="text-sm font-semibold text-text">备注要求</h2>
            </div>
            <button
              type="button"
              onClick={openProfile}
              className="shrink-0 text-[11px] font-medium text-brand transition active:opacity-70"
            >
              编辑资料
            </button>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-text watch:text-[12.5px]">
            {merchant.noteRequirement || (
              <span className="text-muted">未设置，付款人可直接付款。</span>
            )}
          </p>
        </section>

        {/* 收款方式 */}
        <section className="card p-4 watch:rounded-2xl watch:p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">收款方式</h2>
            <span className="text-[11px] text-muted">至少保留一个启用</span>
          </div>
          <div className="mt-2.5 space-y-2">
            {merchant.channels.map((item) => {
              return (
                <div
                  key={item.channel}
                  data-menu="merchant.channel"
                  data-menu-id={item.channel}
                  className="flex items-center gap-2.5 rounded-2xl bg-surface-2 px-3 py-2.5 watch:px-2.5 watch:py-2"
                >
                  <ChannelIcon
                    channel={item.channel}
                    size={36}
                    className="h-9 w-9 shrink-0 rounded-xl watch:h-8 watch:w-8"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <p className="text-[13px] font-medium text-text">{item.label}</p>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px]",
                          item.hasQr ? "bg-success-soft text-success" : "bg-danger/10 text-danger",
                        )}
                      >
                        {item.hasQr ? "已上传" : "未上传"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {item.hasQr ? (
                      <>
                        <IconButton label="查看收款码" onClick={() => setQrView(item.channel)}>
                          <EyeIcon size={15} />
                        </IconButton>
                        <IconButton label="更换收款码" onClick={() => openQrEdit(item.channel)}>
                          <RefreshIcon />
                        </IconButton>
                      </>
                    ) : (
                      <IconButton label="上传收款码" tone="brand" onClick={() => openQrEdit(item.channel)}>
                        <UploadIcon />
                      </IconButton>
                    )}
                    <span
                      data-menu="merchant.switch"
                      data-menu-id={item.channel}
                      className="flex shrink-0 items-center"
                    >
                      <Toggle
                        checked={item.enabled}
                        disabled={busyChannel === item.channel}
                        onChange={(next) => void handleToggle(item, next)}
                        label={`${item.label}收款开关`}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
            未上传或停用的渠道不会显示给付款人。
          </p>
        </section>

        {/* 商品与发布 */}
        <section className="card p-4 watch:rounded-2xl watch:p-3.5">
          <button
            type="button"
            data-menu="merchant.products"
            onClick={() => navigate("/merchant/products")}
            className="flex w-full items-center gap-3 text-left transition active:opacity-80"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand watch:h-9 watch:w-9">
              <BagIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-text">商品与发布</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                商品、价格与备注要求
              </span>
            </span>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
          </button>
        </section>
      </main>

      {/* 商家资料编辑 */}
      <Dialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="商家资料"
        description="保存后对付款人立即生效。"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setProfileOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={savingProfile} onClick={() => void saveProfile()}>
              {savingProfile ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="merchant-name">
              商家名称
            </label>
            <input
              id="merchant-name"
              className="input"
              value={profileName}
              maxLength={20}
              placeholder="例如：三班小卖部"
              onChange={(event) => setProfileName(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">付款人扫码会看到。</p>
          </div>
          <div>
            <label className="label" htmlFor="merchant-note">
              备注要求
            </label>
            <textarea
              id="merchant-note"
              className="input min-h-20 py-2"
              value={profileNote}
              maxLength={120}
              placeholder="例如：请在备注里填写姓名和学号后四位"
              onChange={(event) => setProfileNote(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">付款人下单时会看到。</p>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={qrView !== null}
        onClose={() => setQrView(null)}
        title={qrViewLabel ? `${qrViewLabel}收款码` : "收款码"}
        description="可保存后张贴或发给对方。"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setQrView(null)}>
              关闭
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const channel = qrView;
                setQrView(null);
                if (channel) openQrEdit(channel);
              }}
            >
              更换收款码
            </button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-2.5">
          {qrViewBlob.error ? (
            <div className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-[12px] text-muted">
              <p>{qrViewBlob.error}</p>
              <button
                type="button"
                onClick={qrViewBlob.reload}
                className="mt-2 text-[12px] font-medium text-brand transition active:opacity-70"
              >
                重新加载
              </button>
            </div>
          ) : (
            <QrImage dataUrl={qrViewBlob.url} size={220} alt={`${qrViewLabel}收款码`} />
          )}
        </div>
      </Dialog>

      <Dialog
        open={qrEdit !== null}
        onClose={closeQrEdit}
        title={qrEdit ? `更换${merchant.channels.find((item) => item.channel === qrEdit.channel)?.label ?? ""}收款码` : ""}
        description="识别失败会提示原因，请重新上传。"
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
          {qrEdit?.previewUrl ? <span className="mt-1 text-[11px]">重新选择</span> : null}
        </button>
      </Dialog>

      <PaymentPasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="输入支付密码"
        onSubmit={uploadQr}
      />
    </div>
  );
}

function ChevronRightIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className={className} aria-hidden="true">
      <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NoteIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4" aria-hidden="true">
      <path d="M6 4.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 7 19V6a1.5 1.5 0 0 1 1.5-1.5Z" strokeLinejoin="round" />
      <path d="M9.5 11h5M9.5 14.5h3.5" strokeLinecap="round" />
    </svg>
  );
}

function BagIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
      <path d="M5.5 8h13l1 12.5h-15L5.5 8Z" strokeLinejoin="round" />
      <path d="M9 9.5V7a3 3 0 0 1 6 0v2.5" strokeLinecap="round" />
    </svg>
  );
}
