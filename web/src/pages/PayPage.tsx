/** 收付款页：付款（扫商家校园卡 → 选商品/金额 → 确认 → 支付密码 → 创建订单）与收款（扫客户校园卡 → 金额 → 交给付款人输密码）。 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AmountInput } from "../components/AmountInput";
import { Avatar } from "../components/Avatar";
import { BottomNav } from "../components/BottomNav";
import { BuiltInKeypad } from "../components/BuiltInKeypad";
import { ChannelIcon } from "../components/ChannelIcon";
import { CountdownModal } from "../components/CountdownModal";
import { Dialog } from "../components/Dialog";
import { ErrorBlock, PageLoading, Spinner } from "../components/Loading";
import { Logo } from "../components/Logo";
import { MoneyText } from "../components/MoneyText";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { ProductPicker, selectedToItems, sumProductCents } from "../components/ProductPicker";
import { InlineQrScanner } from "../components/InlineQrScanner";
import { NfcCardReader } from "../components/NfcCardReader";
import { useToast } from "../components/Toast";
import {
  createOrder,
  createPaymentRequest,
  getMerchantPublic,
  getPaymentRequest,
  listProducts,
  lookupTransferTarget,
  merchantCreateOrder,
  resolveDynamicCode,
  scanCard,
  transferOrder,
} from "../lib/api";
import { cn, formatCents, isCardNo, payChannelLabel, randomIdempotencyKey, yuanToCents } from "../lib/format";
import { ApiError, errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import { extractCardContent, extractDynamicToken, parseQrContent } from "../lib/scan";
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

function TransferIcon({ size = 24 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 8h13M13.5 4.5 17 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 16H7M10.5 12.5 7 16l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChannelBadges({ channels }: { channels: PayChannel[] }): ReactNode {
  if (channels.length === 0) return <span className="text-xs text-muted">暂无收款方式</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.map((channel) => (
        <span
          key={channel}
          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text ring-1 ring-line/70"
        >
          <ChannelIcon channel={channel} size={13} />
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

  // 转账
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferStudentNo, setTransferStudentNo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [pendingTransfer, setPendingTransfer] = useState<{
    studentNo: string;
    amountCents: number;
    note: string;
  } | null>(null);
  const transferKey = useRef(randomIdempotencyKey());
  const [transferTarget, setTransferTarget] = useState<PublicUser | null>(null);
  const [transferLookupState, setTransferLookupState] = useState<"idle" | "loading" | "error">("idle");
  const [transferLookupError, setTransferLookupError] = useState("");
  /** 找到收款人后的 3 秒核对倒计时，归零才能继续 */
  const [transferCountdown, setTransferCountdown] = useState(0);

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

  const resolveCardContent = (raw: string): string | null => extractCardContent(raw);

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
    // 商家已发起指定金额收款单：扫校园卡直接进入这笔收款单，不再显示商品/金额界面
    if (result.pendingCollection) {
      navigate(`/collect/id/${result.pendingCollection.id}`);
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
    if (!raw.toLowerCase().includes("gzspay:") && !isCardNo(raw)) {
      toast.error("校园卡号应为 8 位数字或字母");
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

  // 学号变化后自动查询收款人（防抖 350ms），拿到结果再开始 3 秒核对倒计时
  useEffect(() => {
    if (!transferOpen) {
      setTransferTarget(null);
      setTransferLookupState("idle");
      setTransferLookupError("");
      setTransferCountdown(0);
      return;
    }
    const value = transferStudentNo.trim();
    setTransferTarget(null);
    setTransferLookupError("");
    setTransferCountdown(0);
    if (value.length < 4) {
      setTransferLookupState("idle");
      return;
    }
    let active = true;
    setTransferLookupState("loading");
    const timer = window.setTimeout(() => {
      lookupTransferTarget(value)
        .then((user) => {
          if (!active) return;
          setTransferTarget(user);
          setTransferLookupState("idle");
          setTransferCountdown(3);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setTransferLookupState("error");
          setTransferLookupError(errorMessage(cause));
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [transferOpen, transferStudentNo]);

  // 核对倒计时：3 → 2 → 1 → 0
  useEffect(() => {
    if (transferCountdown <= 0) return;
    const timer = window.setTimeout(() => setTransferCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [transferCountdown]);

  /** 打开转账弹窗：每次清空上次填写的内容 */
  const openTransfer = (): void => {
    setTransferStudentNo("");
    setTransferAmount("");
    setTransferNote("");
    setTransferTarget(null);
    setTransferLookupState("idle");
    setTransferLookupError("");
    setTransferCountdown(0);
    setTransferOpen(true);
  };

  /** 校验转账信息后先收起表单，交给支付密码弹窗继续 */
  const confirmTransfer = (): void => {
    const studentNo = transferStudentNo.trim();
    if (!studentNo) {
      toast.error("请输入对方的学号");
      return;
    }
    if (!transferTarget) {
      toast.error("请先确认收款人，没有找到这个学号对应的账号");
      return;
    }
    if (transferCountdown > 0) {
      toast.error(`请核对姓名与头像，${transferCountdown} 秒后即可继续`);
      return;
    }
    const amountCents = yuanToCents(transferAmount);
    if (amountCents === null || amountCents < 1) {
      toast.error("请输入转账金额");
      return;
    }
    if (amountCents > 20000) {
      toast.error("单笔转账不能超过 200 元");
      return;
    }
    setPendingTransfer({ studentNo, amountCents, note: transferNote.trim() });
    setTransferOpen(false);
    setPasswordOpen(true);
  };

  const submitTransfer = async (password: string): Promise<void> => {
    if (!pendingTransfer) return;
    try {
      const order = await transferOrder({
        ...pendingTransfer,
        paymentPassword: password,
        idempotencyKey: transferKey.current,
      });
      transferKey.current = randomIdempotencyKey();
      setPasswordOpen(false);
      setPendingTransfer(null);
      toast.success("转账已发起，等待对方确认收款");
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (cause) {
      const message = errorMessage(cause);
      if (
        cause instanceof ApiError &&
        (cause.code === "PAYMENT_PASSWORD_WRONG" || cause.code === "PAYMENT_PASSWORD_LOCKED")
      ) {
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

    /** 扫码中：摄像头画面直接嵌在页面里，中间留出取景框 */
    const scanningCard = (
      <section className="card overflow-hidden p-0">
        <div className="relative">
          <InlineQrScanner
            active={scannerOpen}
            hint={
              kind === "pay"
                ? "将商家校园卡二维码放入框内，识别成功会自动继续"
                : "将客户校园卡二维码放入框内，识别成功会自动继续"
            }
            onResult={(raw) => {
              void handleScanned(raw).catch((cause: unknown) => handleScanError(cause));
            }}
          />
          {scanning ? (
            <div className="absolute inset-0 grid place-items-center bg-black/50">
              <span className="flex items-center gap-2 text-sm font-medium text-white">
                <Spinner size={16} /> 正在识别…
              </span>
            </div>
          ) : null}
        </div>
        <div className="space-y-2 p-4">
          <button type="button" className="btn btn-outline btn-block" onClick={() => setScannerOpen(false)}>
            停止扫码
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={scanning}
            onClick={() => {
              setScannerOpen(false);
              setManualOpen(true);
            }}
          >
            手动输入校园卡号
          </button>
          <NfcCardReader
            disabled={scanning}
            onRead={(cardNo) => {
              setScannerOpen(false);
              void handleScanned(cardNo);
            }}
          />
        </div>
      </section>
    );

    const introCard = (
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
            {scanning ? "识别中…" : "开始扫码"}
          </button>
          <button type="button" className="btn btn-outline btn-block" disabled={scanning} onClick={() => setManualOpen(true)}>
            手动输入校园卡号
          </button>
          <NfcCardReader disabled={scanning} onRead={(cardNo) => void handleScanned(cardNo)} />
        </div>
      </section>
    );

    return (
      <div className="space-y-4">
        {scannerOpen ? scanningCard : introCard}
        {kind === "pay" ? (
          <button type="button" className="card flex w-full items-center gap-3 p-4 text-left" onClick={openTransfer}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <TransferIcon size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-text">转账给同学</span>
              <span className="mt-0.5 block text-xs text-muted">输入对方学号，用支付密码转账</span>
            </span>
            <span className="text-muted">›</span>
          </button>
        ) : null}
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
            {collectStep === "scan" ? (
              <>
                {scanPanel("collect")}
                <section className="card p-4 text-center">
                  <p className="text-xs leading-relaxed text-muted">
                    不想先扫对方的动态码？可以直接定好金额或商品，让对方扫你的校园卡二维码付款。
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-block mt-3"
                    onClick={() => navigate("/merchant/collect")}
                  >
                    让对方扫码收款
                  </button>
                </section>
              </>
            ) : null}

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

      <Dialog
        open={manualOpen}
        onClose={resetManual}
        title="手动输入校园卡号"
        description="校园卡号为 8 位数字或字母，也可以粘贴二维码中的原始内容；安卓手机可直接用 NFC 读卡。"
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
        <div className="space-y-3">
          <input
            className="input"
            value={manualValue}
            placeholder="例如：A1B2C3D4 或 gzspay:card:..."
            onChange={(event) => setManualValue(event.target.value)}
          />
          <NfcCardReader
            disabled={scanning}
            onRead={(cardNo) => {
              setManualValue(cardNo);
              void handleScanned(cardNo);
            }}
          />
        </div>
      </Dialog>

      <Dialog
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title="转账给同学"
        description="输入对方学号后会显示姓名与头像，核对满 3 秒才能继续。单笔最多 200 元，每天最多 1000 元。"
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline flex-1" onClick={() => setTransferOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={!transferTarget || transferCountdown > 0}
              onClick={confirmTransfer}
            >
              {!transferTarget ? "下一步" : transferCountdown > 0 ? `核对中 ${transferCountdown}s` : "下一步"}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">对方学号</span>
            <input
              className="input"
              inputMode="numeric"
              maxLength={40}
              value={transferStudentNo}
              placeholder="例如 20231234"
              onChange={(event) => setTransferStudentNo(event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-muted">输入完整学号后会自动显示对方的姓名与头像</span>
          </label>
          {transferLookupState === "loading" ? (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Spinner size={14} />
              正在核对学号…
            </p>
          ) : null}
          {transferLookupState === "error" ? <p className="text-xs text-danger">{transferLookupError}</p> : null}
          {transferTarget ? (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3">
              <Avatar name={transferTarget.displayName} avatarUrl={transferTarget.avatarUrl} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text">{transferTarget.displayName}</p>
                <p className="text-xs text-muted">
                  {transferTarget.studentNoMasked ? `学号 ${transferTarget.studentNoMasked}` : "已找到该学号"}
                </p>
              </div>
              {transferCountdown > 0 ? (
                <span className="chip chip-active shrink-0">{transferCountdown}s</span>
              ) : (
                <span className="shrink-0 text-xs font-semibold text-brand">已核对</span>
              )}
            </div>
          ) : null}
          <label className="block">
            <span className="label">转账金额（元）</span>
            <input
              className="input"
              inputMode="decimal"
              value={transferAmount}
              placeholder="例如 20.00"
              onChange={(event) => setTransferAmount(event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-muted">单笔最多 200 元，当天累计最多 1000 元</span>
          </label>
          <label className="block">
            <span className="label">备注（可选）</span>
            <input
              className="input"
              maxLength={120}
              value={transferNote}
              placeholder="让对方知道这笔钱是做什么的"
              onChange={(event) => setTransferNote(event.target.value)}
            />
          </label>
        </div>
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
        onClose={() => {
          setPasswordOpen(false);
          setPendingTransfer(null);
        }}
        onSubmit={pendingTransfer ? submitTransfer : submitPay}
        title="输入支付密码"
        description={
          pendingTransfer
            ? `向 ${transferTarget?.displayName ?? `学号 ${pendingTransfer.studentNo}`} 转账 ¥${formatCents(pendingTransfer.amountCents)}`
            : `向 ${merchant?.merchantName ?? "商家"} 支付 ¥${formatCents(payAmountCents)}`
        }
      />

      <BottomNav />
    </div>
  );
}
