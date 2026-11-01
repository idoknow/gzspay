/** 商家注册：名称默认真实姓名、多选收款方式并上传各渠道收款码（后端解码校验）。备注要求注册后在商家中心填写。 */

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Spinner } from "../components/Loading";
import { useToast } from "../components/Toast";
import { PAY_CHANNELS, registerMerchant } from "../lib/api";
import { cn } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAuth } from "../lib/session";
import { PAY_CHANNEL_LABELS, type PayChannel } from "../lib/types";

interface ChannelFile {
  file: File;
  previewUrl: string;
}

export function MerchantRegisterPage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const { me, patchMe } = useAuth();
  const [name, setName] = useState(me?.displayName ?? "");
  const [channels, setChannels] = useState<PayChannel[]>([]);
  const [files, setFiles] = useState<Partial<Record<PayChannel, ChannelFile>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputsRef = useRef<Partial<Record<PayChannel, HTMLInputElement | null>>>({});
  const filesRef = useRef(files);
  filesRef.current = files;

  // 清空时回收预览 URL
  useEffect(() => {
    return () => {
      for (const value of Object.values(filesRef.current)) {
        if (value) URL.revokeObjectURL(value.previewUrl);
      }
    };
  }, []);

  const toggleChannel = (channel: PayChannel): void => {
    setChannels((current) => {
      if (current.includes(channel)) {
        const next = current.filter((item) => item !== channel);
        setFiles((prev) => {
          const removed = prev[channel];
          if (removed) {
            URL.revokeObjectURL(removed.previewUrl);
            const rest = { ...prev };
            delete rest[channel];
            return rest;
          }
          return prev;
        });
        return next;
      }
      return [...current, channel];
    });
  };

  const handlePick = (channel: PayChannel, event: ChangeEvent<HTMLInputElement>): void => {
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
    setFiles((prev) => {
      const old = prev[channel];
      if (old) URL.revokeObjectURL(old.previewUrl);
      return { ...prev, [channel]: { file, previewUrl: URL.createObjectURL(file) } };
    });
  };

  const handleSubmit = async (): Promise<void> => {
    const finalName = name.trim();
    if (!finalName) {
      toast.error("请填写商家名称");
      return;
    }
    if (channels.length === 0) {
      toast.error("请至少选择一种收款方式");
      return;
    }
    for (const channel of channels) {
      if (!files[channel]) {
        toast.error(`请上传${PAY_CHANNEL_LABELS[channel]}收款码`);
        return;
      }
    }
    const form = new FormData();
    form.append("name", finalName);
    form.append("channels", JSON.stringify(channels));
    for (const channel of channels) {
      const entry = files[channel];
      if (entry) form.append(`qr_${channel}`, entry.file);
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await registerMerchant(form);
      if (me) patchMe({ ...me, isMerchant: true });
      toast.success("商家注册成功，可在「商品与发布」填写备注要求");
      navigate("/merchant", { replace: true });
    } catch (cause) {
      const message = errorMessage(cause);
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="商家注册" back />

      <main className="page space-y-4 pb-10 pt-4">
        {me?.isMerchant ? (
          <section className="card p-4">
            <p className="text-sm text-text">你已经是商家，无需重复注册。</p>
            <button type="button" className="btn btn-primary btn-block mt-3" onClick={() => navigate("/merchant")}>
              进入商家中心
            </button>
          </section>
        ) : null}

        <section className="card space-y-3 p-4">
          <div>
            <label className="label" htmlFor="merchant-name">
              商家名称
            </label>
            <input
              id="merchant-name"
              className="input"
              value={name}
              maxLength={30}
              placeholder="默认使用你的姓名，可修改"
              onChange={(event) => setName(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted">
              付款人扫码后会看到这个名称。备注要求可在注册后到「商品与发布」填写。
            </p>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="text-sm font-semibold text-text">收款方式（可多选）</h2>
          <p className="mt-1 text-[11px] text-muted">至少启用一种，未启用的渠道不会展示给付款人。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PAY_CHANNELS.map((channel) => {
              const active = channels.includes(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  className={cn("chip", active && "chip-active")}
                  onClick={() => toggleChannel(channel)}
                >
                  {PAY_CHANNEL_LABELS[channel]}
                </button>
              );
            })}
          </div>

          <div className="mt-3 space-y-3">
            {channels.length === 0 ? (
              <p className="rounded-2xl bg-surface-2 px-3 py-3 text-center text-xs text-muted">
                选择收款方式后，需要分别上传对应的收款码图片
              </p>
            ) : null}
            {channels.map((channel) => {
              const entry = files[channel];
              return (
                <div key={channel} className="rounded-2xl border border-line bg-surface-2 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-text">{PAY_CHANNEL_LABELS[channel]}收款码</p>
                    <span className={cn("text-[11px]", entry ? "text-success" : "text-muted")}>
                      {entry ? "已选择" : "待上传"}
                    </span>
                  </div>
                  <input
                    ref={(element) => {
                      inputsRef.current[channel] = element;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => handlePick(channel, event)}
                  />
                  <button
                    type="button"
                    className="mt-2 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface px-3 py-4 text-xs text-muted"
                    onClick={() => inputsRef.current[channel]?.click()}
                  >
                    {entry ? (
                      <img src={entry.previewUrl} alt={`${PAY_CHANNEL_LABELS[channel]}收款码预览`} className="max-h-44 rounded-lg object-contain" />
                    ) : (
                      <>
                        <span className="text-xl">＋</span>
                        <span className="mt-1">选择{PAY_CHANNEL_LABELS[channel]}收款码截图</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            上传后由系统自动识别校验；识别失败会提示原因，请重新上传完整、清晰的收款码截图。收款码用于付款人查看与付款，资金不经过 gzspay。
          </p>
        </section>

        {submitError ? (
          <p className="rounded-2xl bg-danger-soft px-3 py-2.5 text-xs leading-relaxed text-danger">{submitError}</p>
        ) : null}

        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={submitting || me?.isMerchant === true}
          onClick={() => void handleSubmit()}
        >
          {submitting ? <Spinner size={16} /> : null}
          提交注册
        </button>
        <p className="text-center text-[11px] leading-relaxed text-muted">
          提交即表示同意《服务条款》与《隐私协议》。
          <br />
          请确保上传的是本人收款码。
        </p>
      </main>
    </div>
  );
}
