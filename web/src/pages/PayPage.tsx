/** 收付款页：付款（扫商家校园卡 → 选商品/金额 → 确认 → 支付密码 → 创建订单）与收款（扫客户校园卡 → 金额 → 交给付款人输密码）。 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AmountInput } from "../components/AmountInput";
import { Avatar } from "../components/Avatar";
import { BottomNav } from "../components/BottomNav";
import { BuiltInKeypad } from "../components/BuiltInKeypad";
import { CountdownModal } from "../components/CountdownModal";
import { Dialog } from "../components/Dialog";
import { ErrorBlock, PageLoading, Spinner } from "../components/Loading";
import { Logo } from "../components/Logo";
import { MoneyText } from "../components/MoneyText";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { ProductPicker, selectedToItems, sumProductCents } from "../components/ProductPicker";
import { QrScanner } from "../components/QrScanner";
import { useToast } from "../components/Toast";
import {
  createOrder,
  createPaymentRequest,
  getMerchantPublic,
  getPaymentRequest,
  listProducts,
  merchantCreateOrder,
  resolveDynamicCode,
  scanCard,
} from "../lib/api";
import { cn, formatCents, payChannelLabel, randomIdempotencyKey, yuanToCents } from "../lib/format";
import { ApiError, errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import { CARD_PREFIX, extractCardContent, extractDynamicToken, parseQrContent } from "../lib/scan";
import { useAuth } from "../lib/session";
import type { MerchantPublic, PayChannel, PaymentRequest, Product, PublicUser } from "../lib/types";

type Mode = "pay" | "collect";
type PayStep = "scan" | "merchant" | "confirm";
type CollectStep = "scan" | "amount" | "handoff" | "waiting";

function ScanIcon({ size = 26 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3M3 12h18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CardQrIcon({ size = 24 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 14h2.5v2.5H14zM18.5 18.5H21V21h-2.5z" fill="currentColor" />
      <path d="M14 18.5h2M18.5 14v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ShopIcon({ size = 24 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9.5V20h16V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3 9.5 5.4 4h13.2L21 9.5a2.4 2.4 0 0 1-4.5 1.2 2.4 2.4 0 0 1-4.5 0 2.4 2.4 0 0 1-4.5 0A2.4 2.4 0 0 1 3 9.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9.5 20v-5h5v5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function ChannelBadges({ channels }: { channels: PayChannel[] }): ReactNode {
  if (channels.length === 0) return <span className="text-xs text-muted">暂无收款方式</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.map((channel) => (
        <span key={channel} className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">
          {payChannelLabel(channel)}
        </span>
      ))}
    </div>
  );
}

function resetOfSelection(): Record<string, number> {
  return {};
}

export function PayPage(): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useAuth();

  const [mode, setMode] = useState<Mode>("pay");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [scanning, setScanning] = useState(false);

  // 付款
  const [step, setStep] = useState<PayStep>("scan");
  const [merchant, setMerchant] = useState<MerchantPublic | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>(resetOfSelection);
  const [customAmount, setCustomAmount] = useState("");
  const [reservedNote, setReservedNote] = useState("");
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const idempotencyKey = useRef(randomIdempotencyKey());

  // 收款
  const [collectStep, setCollectStep] = useState<CollectStep>("scan");
  const [customerCard, setCustomerCard] = useState<string | null>(null);
  const [customer, setCustomer] = useState<PublicUser | null>(null);
  const [collectSelected, setCollectSelected] = useState<Record<string, number>>(resetOfSelection);
  const [collectAmount, setCollectAmount] = useState("");
  const [collectNote, setCollectNote] = useState("");
  const collectKey = useRef(randomIdempotencyKey());
  const [collectDynamicToken, setCollectDynamicToken] = useState<string | null>(null);
  const [waitingRequest, setWaitingRequest] = useState<PaymentRequest | null>(null);

  // 动态码入口（?token=）或校园卡入口（?card=）
  const [searchParams] = useSearchParams();
  const [dynamicToken, setDynamicToken] = useState<string | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);

  const merchantProducts = useAsync<Product[]>(
    () => (mode === "collect" && me?.isMerchant ? listProducts() : Promise.resolve([])),
    [mode, me?.isMerchant, collectStep],
  );

  const defaultReservedNote = useMemo(() => {
    const name = me?.fullName || me?.displayName || "";
    const tail = me?.studentNo ? me.studentNo.slice(-4) : "";
    return `${name} ${tail}`.trim();
  }, [me]);

  useEffect(() => {
    if (mode !== "collect") return;
    if (!me?.isMerchant) return;
    if (collectStep === "amount") merchantProducts.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, collectStep, me?.isMerchant]);

  const switchMode = (next: Mode): void => {
    if (next === mode) return;
    setMode(next);
    setScannerOpen(false);
    setManualOpen(false);
    setManualValue("");
    setEntryLoading(false);
    // 重置付款流程
    setStep("scan");
    setMerchant(null);
    setSelected({});
    setCustomAmount("");
    setReservedNote("");
    setDynamicToken(null);
    // 重置收款流程
    setCollectStep("scan");
    setCustomerCard(null);
    setCustomer(null);
    setCollectSelected({});
    setCollectAmount("");
    setCollectNote("");
    setCollectDynamicToken(null);
    setWaitingRequest(null);
  };

  const resolveCardContent = (raw: string): string | null => {
    const content = extractCardContent(raw);
    if (content) return content;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return `${CARD_PREFIX}${trimmed}`;
  };

  /** 解析商家动态码：只读解析（不消费），拿到商家主页后进入付款流程。 */
  const loadDynamicPay = async (token: string): Promise<void> => {
    const result = await resolveDynamicCode(token);
    if (result.user.id === me?.id) {
      toast.error("不能给自己付款");
      return;
    }
    if (!result.isMerchant) {
      toast.error("该动态码不是商家收款码，无法付款");
      return;
    }
    const publicInfo = await getMerchantPublic(result.user.id);
    setMerchant(publicInfo);
    setDynamicToken(token);
    setSelected({});
    setCustomAmount("");
    setReservedNote(defaultReservedNote);
    idempotencyKey.current = randomIdempotencyKey();
    setStep("merchant");
  };

  /** 扫描客户动态码：解析出客户后进入收款金额填写，下一步发起收款请求。 */
  const loadDynamicCollect = async (token: string): Promise<void> => {
    if (!me?.isMerchant) {
      toast.error("收款需要先注册商家，正在为你打开注册页");
      navigate("/merchant/register");
      return;
    }
    const result = await resolveDynamicCode(token);
    if (result.user.id === me.id) {
      toast.error("不能向自己收款");
      return;
    }
    setCustomerCard(null);
    setCollectDynamicToken(token);
    setCustomer(result.user);
    setCollectSelected({});
    setCollectAmount("");
    setCollectNote("");
    setWaitingRequest(null);
    setCollectStep("amount");
  };

  const scanForPay = async (content: string): Promise<void> => {
    const result = await scanCard(content);
    if (result.isSelf) {
      toast.error("不能给自己付款");
      return;
    }
    if (!result.isMerchant) {
      toast.error("对方还不是商家，暂时无法付款");
      return;
    }
    const publicInfo = await getMerchantPublic(result.user.id);
    setMerchant(publicInfo);
    setDynamicToken(null);
    setSelected({});
    setCustomAmount("");
    setReservedNote(defaultReservedNote);
    idempotencyKey.current = randomIdempotencyKey();
    setStep("merchant");
  };

  const scanForCollect = async (content: string): Promise<void> => {
    if (!me?.isMerchant) {
      toast.error("收款需要先注册商家，正在为你打开注册页");
      navigate("/merchant/register");
      return;
    }
    const result = await scanCard(content);
    if (result.isSelf) {
      toast.error("不能向自己收款");
      return;
    }
    setCustomerCard(content);
    setCollectDynamicToken(null);
    setCustomer(result.user);
    setCollectSelected({});
    setCollectAmount("");
    setCollectNote("");
    setWaitingRequest(null);
    collectKey.current = randomIdempotencyKey();
    setCollectStep("amount");
    resetManual();
  };

  const handleScanned = async (raw: string): Promise<void> => {
    setScannerOpen(false);
    setScanning(true);
    try {
      const parsed = parseQrContent(raw);
      if (parsed.kind === "dynamic") {
        const token = extractDynamicToken(raw) ?? parsed.value;
        if (mode === "pay") await loadDynamicPay(token);
        else await loadDynamicCollect(token);
        return;
      }
      const content = resolveCardContent(raw);
      if (!content) {
        toast.error("无法识别的二维码，请扫描 gzspay 校园卡或动态码");
        return;
      }
      if (mode === "pay") await scanForPay(content);
      else await scanForCollect(content);
    } finally {
      setScanning(false);
    }
  };

  const handleManualSubmit = async (): Promise<void> => {
    const raw = manualValue.trim();
    if (!raw) {
      toast.error("请输入校园卡号或二维码内容");
      return;
    }
    try {
      await handleScanned(raw);
      resetManual();
    } catch (cause) {
      handleScanError(cause);
    }
  };

  const resetManual = (): void => {
    setManualOpen(false);
    setManualValue("");
  };

  const handleScanError = (cause: unknown): void => {
    if (cause instanceof ApiError && cause.code === "NOT_FOUND") {
      toast.error("该校园卡尚未绑定 gzspay 账号，请提醒对方先注册");
      return;
    }
    toast.error(errorMessage(cause));
  };

  // 通过动态码 / 校园卡链接进入时自动发起（/pay?token=xxx 或 /pay?card=xxx）
  useEffect(() => {
    const token = searchParams.get("token");
    const card = searchParams.get("card");
    if (!token && !card) return;
    let cancelled = false;
    setEntryLoading(true);
    const run = async (): Promise<void> => {
      try {
        if (token) {
          await loadDynamicPay(token);
        } else if (card) {
          const content = resolveCardContent(card);
          if (content) await scanForPay(content);
        }
      } catch (cause) {
        if (!cancelled) handleScanError(cause);
      } finally {
        if (!cancelled) setEntryLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 等待付款人确认收款请求：轮询请求状态，成功后跳转订单详情
  useEffect(() => {
    if (!waitingRequest) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const latest = await getPaymentRequest(waitingRequest.id);
          if (cancelled) return;
          if (latest.status === "accepted") {
            setWaitingRequest(null);
            toast.success("对方已确认付款");
            if (latest.orderId) navigate(`/orders/${latest.orderId}`);
            else setCollectStep("scan");
            return;
          }
          if (latest.status === "rejected") {
            toast.error("对方拒绝了收款请求");
            setWaitingRequest(null);
            setCollectStep("amount");
          } else if (latest.status === "expired") {
            toast.error("收款请求已过期，请重新发起");
            setWaitingRequest(null);
            setCollectStep("amount");
          }
        } catch {
          // 轮询失败忽略，等待下一轮
        }
      })();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [waitingRequest, navigate, toast]);

  const payItems = useMemo(
    () => (merchant ? selectedToItems(merchant.products, selected) : []),
    [merchant, selected],
  );
  const payProductsCents = useMemo(
    () => (merchant ? sumProductCents(merchant.products, selected) : 0),
    [merchant, selected],
  );
  const payAmountCents = payProductsCents > 0 ? payProductsCents : (yuanToCents(customAmount) ?? 0);
  const payItemsCount = Object.values(selected).reduce((sum, quantity) => sum + quantity, 0);

  const collectItems = useMemo(
    () => selectedToItems(merchantProducts.data ?? [], collectSelected),
    [merchantProducts.data, collectSelected],
  );
  const collectProductsCents = sumProductCents(merchantProducts.data ?? [], collectSelected);
  const collectAmountCents = collectProductsCents > 0 ? collectProductsCents : (yuanToCents(collectAmount) ?? 0);

  const goPayConfirm = (): void => {
    if (!merchant) return;
    if (merchant.channels.length === 0) {
      toast.error("商家尚未启用收款方式，请与商家联系");
      return;
    }
    if (payItemsCount === 0 && payAmountCents <= 0) {
      toast.error("请选择商品或输入支付金额");
      return;
    }
    if (payItemsCount === 0 && (payAmountCents < 1 || payAmountCents > 500000)) {
      toast.error("支付金额需在 0.01 ~ 5000 元之间");
      return;
    }
    if (merchant.noteRequirement.trim()) {
      setRequirementOpen(true);
      return;
    }
    setStep("confirm");
  };

  const submitPay = async (password: string): Promise<void> => {
    if (!merchant) return;
    try {
      const order = await createOrder({
        merchantUserId: merchant.user.id,
        items: payItems.length > 0 ? payItems : undefined,
        amountCents: payItems.length > 0 ? undefined : payAmountCents,
        reservedNote: reservedNote.trim(),
        paymentPassword: password,
        idempotencyKey: idempotencyKey.current,
        source: "scan",
        dynamicCodeToken: dynamicToken ?? undefined,
      });
      setPasswordOpen(false);
      toast.success("订单已创建，请完成付款");
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (cause) {
      const message = errorMessage(cause);
      if (cause instanceof ApiError && (cause.code === "PAYMENT_PASSWORD_WRONG" || cause.code === "PAYMENT_PASSWORD_LOCKED")) {
        toast.error(message);
        throw cause;
      }
      setPasswordOpen(false);
      toast.error(message);
    }
  };

  /** 商家扫客户动态码后：发起收款请求，客户手机通过 SSE 弹出确认。 */
  const sendPaymentRequest = async (): Promise<void> => {
    if (!collectDynamicToken) return;
    setScanning(true);
    try {
      const request = await createPaymentRequest({
        token: collectDynamicToken,
        amountCents: collectAmountCents,
        items: collectItems.length > 0 ? collectItems : undefined,
        reservedNote: collectNote.trim(),
      });
      setWaitingRequest(request);
      setCollectStep("waiting");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setScanning(false);
    }
  };

  const goCollectHandoff = (): void => {
    if (collectAmountCents <= 0) {
      toast.error("请选择商品或输入收款金额");
      return;
    }
    if (collectAmountCents > 500000) {
      toast.error("单笔金额不能超过 5000 元");
      return;
    }
    if (collectDynamicToken) {
      void sendPaymentRequest();
      return;
    }
    setCollectStep("handoff");
  };

  const submitCollect = async (password: string): Promise<void> => {
    if (!customerCard) return;
    try {
      const order = await merchantCreateOrder({
        cardContent: customerCard,
        items: collectItems.length > 0 ? collectItems : undefined,
        amountCents: collectItems.length > 0 ? undefined : collectAmountCents,
        reservedNote: collectNote.trim(),
        paymentPassword: password,
        idempotencyKey: collectKey.current,
      });
      toast.success("订单已创建");
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (cause) {
      const message = errorMessage(cause);
      if (cause instanceof ApiError && (cause.code === "PAYMENT_PASSWORD_WRONG" || cause.code === "PAYMENT_PASSWORD_LOCKED")) {
        toast.error(message);
        throw cause;
      }
      toast.error(message);
    }
  };

  const header = (
    <header className="sticky top-0 z-30 safe-top glass border-b border-line">
      <div className="mx-auto flex w-full max-w-[520px] items-center justify-between gap-3 px-4 py-3">
        <Logo size={30} wordmark />
        <div className="segmented w-[168px]" role="tablist" aria-label="收付款模式">
          <span
            aria-hidden="true"
            className="segmented-thumb left-1"
            style={{
              width: "calc(50% - 4px)",
              transform: mode === "pay" ? "translateX(0%)" : "translateX(100%)",
            }}
          />
          {(["pay", "collect"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              className={cn("segmented-item", mode === item && "segmented-item-active")}
              onClick={() => switchMode(item)}
            >
              {item === "pay" ? "付款" : "收款"}
            </button>
          ))}
        </div>
        <span className="w-[30px]" />
      </div>
    </header>
  );

  /** 未注册商家时，收款入口只展示开通引导，避免误以为扫码即可收款。 */
  const collectRegisterPanel = (
    <div className="space-y-4">
      <section className="card overflow-hidden p-0">
        <div className="bg-accent-soft px-4 py-8 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-surface text-accent shadow-sm">
            <ShopIcon size={38} />
          </div>
          <h1 className="mt-4 text-lg font-bold text-text">收款需要先开通商家</h1>
          <p className="mx-auto mt-1.5 max-w-[300px] text-xs leading-relaxed text-muted">
            收款是以商家身份向同学收钱。注册商家并上传至少一种收款码（支付宝、微信支付、QQ 钱包）后，才能扫客户校园卡收款或接收动态码收款请求。
          </p>
        </div>
        <div className="space-y-2 p-4">
          <button type="button" className="btn btn-primary btn-block" onClick={() => navigate("/merchant/register")}>
            去注册商家
          </button>
          <button type="button" className="btn btn-outline btn-block" onClick={() => navigate("/merchant")}>
            了解商家中心
          </button>
        </div>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-text">注册后可以</h2>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· 扫客户的校园卡收款，手机交给对方输入支付密码</li>
          <li>· 接收他人的动态码付款，请求实时推送到你的手机</li>
          <li>· 上架商品、填写备注要求，让付款人自助下单</li>
        </ul>
        <p className="text-[11px] leading-relaxed text-muted">
          资金通过你自己的第三方收款码流转，gzspay 不代收代付。备注要求可以在注册后到「商品与发布」填写。
        </p>
      </section>
    </div>
  );

  const scanPanel = (kind: Mode): ReactNode => {
    if (kind === "collect" && !me?.isMerchant) return collectRegisterPanel;
    return (
    <div className="space-y-4">
      <section className="card overflow-hidden p-0">
        <div className="bg-surface-2 px-4 py-8 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-surface text-brand shadow-sm">
            <ScanIcon size={38} />
          </div>
          <h1 className="mt-4 text-lg font-bold text-text">
            {kind === "pay" ? "扫一扫商家校园卡" : "扫一扫客户校园卡"}
          </h1>
          <p className="mx-auto mt-1.5 max-w-[280px] text-xs leading-relaxed text-muted">
            {kind === "pay"
              ? "扫描商家出示的校园卡二维码，选择商品或输入金额后完成付款。"
              : "扫描客户的校园卡二维码，输入金额后请把手机交给付款人输入支付密码。"}
          </p>
        </div>
        <div className="space-y-2 p-4">
          <button
            type="button"
            className="btn btn-primary btn-block gap-2"
            disabled={scanning}
            onClick={() => setScannerOpen(true)}
          >
            {scanning ? <Spinner size={16} /> : <ScanIcon size={20} />}
            {scanning ? "识别中…" : "打开摄像头扫码"}
          </button>
          <button type="button" className="btn btn-outline btn-block" disabled={scanning} onClick={() => setManualOpen(true)}>
            手动输入校园卡号
          </button>
        </div>
      </section>
      <button type="button" className="card flex w-full items-center gap-3 p-4 text-left" onClick={() => navigate("/dynamic-code")}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <CardQrIcon size={24} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text">我的收付款码</span>
          <span className="mt-0.5 block text-xs text-muted">出示动态收款码，对方扫码即可付款</span>
        </span>
        <span className="text-muted">›</span>
      </button>
    </div>
    );
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      {header}

      <main className="page page-with-nav space-y-4 pt-4">
        {entryLoading ? (
          <PageLoading text="正在识别二维码…" />
        ) : mode === "pay" ? (
          <>
            {step === "scan" || !merchant ? scanPanel("pay") : null}

            {step === "merchant" && merchant ? (
              <>
                <section className="card p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={merchant.user.displayName} avatarUrl={merchant.user.avatarUrl} size={48} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-text">{merchant.merchantName}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {merchant.user.studentNoMasked ? `学号 ${merchant.user.studentNoMasked}` : "已认证商家"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <ChannelBadges channels={merchant.channels} />
                  </div>
                </section>

                {merchant.noteRequirement.trim() ? (
                  <section className="rounded-2xl bg-accent-soft px-4 py-3">
                    <p className="text-[11px] font-semibold text-warning">商家备注要求</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-text">
                      {merchant.noteRequirement}
                    </p>
                  </section>
                ) : null}

                <section className="card p-4">
                  <h2 className="text-sm font-semibold text-text">选择商品</h2>
                  {merchant.products.length > 0 ? (
                    <div className="mt-2">
                      <ProductPicker
                        products={merchant.products}
                        selected={selected}
                        onChange={(next) => {
                          setSelected(next);
                          setCustomAmount("");
                        }}
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted">商家暂未上架商品，可直接输入金额付款。</p>
                  )}

                  <div className="divider my-4" />
                  <h2 className="text-sm font-semibold text-text">支付金额</h2>
                  {payProductsCents > 0 ? (
                    <p className="mt-2 text-sm text-muted">
                      已选 {payItemsCount} 件商品，合计 <MoneyText cents={payProductsCents} size="md" />
                    </p>
                  ) : (
                    <div className="mt-2">
                      <AmountInput
                        value={customAmount}
                        onChange={(value) => {
                          setCustomAmount(value);
                          setSelected({});
                        }}
                        placeholder="0.00"
                      />
                      <p className="mt-1 text-[11px] text-muted">也可以直接输入金额付款</p>
                    </div>
                  )}

                  <div className="divider my-4" />
                  <label className="label" htmlFor="reservedNote">
                    预留备注（默认姓名 + 学号后四位，可修改）
                  </label>
                  <textarea
                    id="reservedNote"
                    className="input min-h-[72px] py-3"
                    value={reservedNote}
                    maxLength={200}
                    placeholder="例如：张三 1234"
                    onChange={(event) => setReservedNote(event.target.value)}
                  />
                </section>

                <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 shadow-sm">
                  <span className="text-sm text-muted">需支付</span>
                  <MoneyText cents={payAmountCents} size="lg" />
                </div>

                <button type="button" className="btn btn-primary btn-block" onClick={goPayConfirm}>
                  下一步
                </button>
              </>
            ) : null}

            {step === "confirm" && merchant ? (
              <>
                <section className="card p-4">
                  <h2 className="text-sm font-semibold text-text">确认付款信息</h2>
                  <div className="mt-3 flex items-center gap-3">
                    <Avatar name={merchant.merchantName} avatarUrl={merchant.user.avatarUrl} size={42} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text">{merchant.merchantName}</p>
                      <p className="text-xs text-muted">收款方</p>
                    </div>
                  </div>
                  <div className="divider my-3" />
                  {payItems.length > 0 ? (
                    <div className="space-y-2">
                      {payItems.map((item) => (
                        <div key={item.productId} className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate text-text">
                            {merchant.products.find((product) => product.id === item.productId)?.name ?? "商品"}
                            <span className="ml-1 text-xs text-muted">×{item.quantity}</span>
                          </span>
                          <span className="text-amount shrink-0 text-text">
                            ¥
                            {formatCents(
                              (merchant.products.find((product) => product.id === item.productId)?.priceCents ?? 0) *
                                item.quantity,
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-text">自定义付款</p>
                  )}
                  <div className="divider my-3" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">金额</span>
                    <MoneyText cents={payAmountCents} size="lg" />
                  </div>
                  {reservedNote.trim() ? (
                    <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
                      预留备注：{reservedNote}
                    </p>
                  ) : null}
                </section>

                <p className="px-1 text-center text-[11px] leading-relaxed text-muted">
                  请核对收款方信息。资金通过第三方收款码流转，gzspay 不代收代付。
                </p>

                <button type="button" className="btn btn-primary btn-block" onClick={() => setPasswordOpen(true)}>
                  确认并输入支付密码
                </button>
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep("merchant")}>
                  返回修改
                </button>
              </>
            ) : null}
          </>
        ) : (
          <>
            {collectStep === "scan" ? scanPanel("collect") : null}

            {collectStep === "amount" && customer ? (
              <>
                <section className="card p-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={customer.displayName} avatarUrl={customer.avatarUrl} size={46} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-text">{customer.displayName}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {customer.studentNoMasked ? `学号 ${customer.studentNoMasked}` : "付款人"}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="card p-4">
                  <h2 className="text-sm font-semibold text-text">选择商品</h2>
                  {merchantProducts.loading ? (
                    <PageLoading text="正在加载商品…" />
                  ) : merchantProducts.error ? (
                    <ErrorBlock message={merchantProducts.error} onRetry={merchantProducts.reload} compact />
                  ) : (merchantProducts.data ?? []).length > 0 ? (
                    <div className="mt-2">
                      <ProductPicker
                        products={merchantProducts.data ?? []}
                        selected={collectSelected}
                        onChange={(next) => {
                          setCollectSelected(next);
                          setCollectAmount("");
                        }}
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted">暂未上架商品，可直接输入金额。</p>
                  )}

                  <div className="divider my-4" />
                  <h2 className="text-sm font-semibold text-text">收款金额</h2>
                  {collectProductsCents > 0 ? (
                    <p className="mt-2 text-sm text-muted">
                      合计 <MoneyText cents={collectProductsCents} size="md" />
                    </p>
                  ) : (
                    <div className="mt-2">
                      <AmountInput value={collectAmount} onChange={(value) => {
                        setCollectAmount(value);
                        setCollectSelected({});
                      }} placeholder="0.00" />
                    </div>
                  )}

                  <div className="divider my-4" />
                  <label className="label" htmlFor="collectNote">
                    备注（选填，会展示给付款人）
                  </label>
                  <textarea
                    id="collectNote"
                    className="input min-h-[72px] py-3"
                    value={collectNote}
                    maxLength={200}
                    placeholder="例如：奶茶两杯"
                    onChange={(event) => setCollectNote(event.target.value)}
                  />
                </section>

                <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 shadow-sm">
                  <span className="text-sm text-muted">应收</span>
                  <MoneyText cents={collectAmountCents} size="lg" />
                </div>

                <button type="button" className="btn btn-primary btn-block" onClick={goCollectHandoff}>
                  下一步
                </button>
              </>
            ) : null}

            {collectStep === "waiting" && customer && waitingRequest ? (
              <section className="card p-6 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <Spinner size={26} />
                </div>
                <h2 className="mt-4 text-base font-bold text-text">已发送收款请求</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  已发送到 {customer.displayName} 的手机，请等待对方核对金额并输入支付密码确认。
                </p>
                <div className="mt-4 rounded-2xl bg-surface-2/70 py-4">
                  <MoneyText cents={waitingRequest.amountCents} size="xl" />
                </div>
                <p className="mt-2 text-[11px] text-muted">收款请求 60 秒内有效，对方确认后会自动跳转订单详情</p>
                <button
                  type="button"
                  className="btn btn-outline btn-block mt-4"
                  onClick={() => {
                    setWaitingRequest(null);
                    setCollectStep("amount");
                  }}
                >
                  取消等待
                </button>
              </section>
            ) : null}

            {collectStep === "handoff" && customer ? (
              <>
                <section className="card p-4">
                  <div className="text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                      <CardQrIcon size={26} />
                    </div>
                    <h2 className="mt-3 text-base font-bold text-text">请把手机交给付款人</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      付款人 {customer.displayName} 将在你的手机上输入 6 位支付密码完成付款
                    </p>
                  </div>
                  <div className="divider my-3" />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">商家</span>
                    <span className="font-medium text-text">{me?.displayName ?? "我"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted">付款人</span>
                    <span className="font-medium text-text">{customer.displayName}</span>
                  </div>
                  {collectItems.length > 0 ? (
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-muted">商品</span>
                      <span className="font-medium text-text">{collectItems.length} 项</span>
                    </div>
                  ) : null}
                  {collectNote.trim() ? (
                    <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">备注：{collectNote}</p>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm text-muted">金额</span>
                    <MoneyText cents={collectAmountCents} size="lg" />
                  </div>
                </section>

                <section className="card p-4">
                  <BuiltInKeypad
                    title="付款人输入支付密码"
                    description="密码只在本机输入，不会显示明文"
                    onSubmit={submitCollect}
                    onCancel={() => setCollectStep("amount")}
                    cancelText="返回修改金额"
                  />
                </section>

                <p className="px-1 text-center text-[11px] leading-relaxed text-muted">
                  请核对收款方信息。资金通过第三方收款码流转，gzspay 不代收代付。
                </p>
              </>
            ) : null}
          </>
        )}
      </main>

      <QrScanner
        open={scannerOpen}
        title={mode === "pay" ? "扫描商家校园卡" : "扫描客户校园卡"}
        hint="将校园卡二维码放入取景框内，即可自动识别"
        manualLabel={mode === "pay" ? "商家校园卡号" : "客户校园卡号"}
        manualPlaceholder="例如 2023123456"
        onResult={(raw) => {
          void handleScanned(raw).catch((cause: unknown) => handleScanError(cause));
        }}
        onClose={() => setScannerOpen(false)}
      />

      <Dialog
        open={manualOpen}
        onClose={resetManual}
        title="手动输入校园卡号"
        description="输入对方校园卡卡号，或粘贴二维码中的原始内容。"
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline flex-1" onClick={resetManual}>
              取消
            </button>
            <button type="button" className="btn btn-primary flex-1" disabled={scanning} onClick={() => void handleManualSubmit()}>
              {scanning ? <Spinner size={16} /> : null}
              确定
            </button>
          </div>
        }
      >
        <input
          className="input"
          value={manualValue}
          placeholder="例如：20231234 或 gzspay:card:..."
          onChange={(event) => setManualValue(event.target.value)}
        />
      </Dialog>

      <CountdownModal
        open={requirementOpen}
        title="商家备注要求"
        seconds={3}
        confirmText="我已阅读"
        onClose={() => {
          setRequirementOpen(false);
          setStep("confirm");
        }}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
          {merchant?.noteRequirement ?? ""}
        </p>
      </CountdownModal>

      <PaymentPasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onSubmit={submitPay}
        title="输入支付密码"
        description={`向 ${merchant?.merchantName ?? "商家"} 支付 ¥${formatCents(payAmountCents)}`}
      />

      <BottomNav />
    </div>
  );
}
