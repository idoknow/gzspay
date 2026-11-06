/** 服务条款 / 隐私协议的阅读入口：点击后在弹窗里渲染全文（登录页、商家注册页等公共位置使用）。 */

import { useEffect, useState, type ReactNode } from "react";
import { getAbout } from "../lib/api";
import { Markdown } from "../lib/markdown";
import type { AboutResponse } from "../lib/types";
import { Dialog } from "./Dialog";
import { Spinner } from "./Loading";

type DocKey = "privacy" | "terms";

const DOC_TITLES: Record<DocKey, string> = {
  privacy: "隐私协议",
  terms: "服务条款",
};

export interface LegalDocLinksProps {
  /** 链接前的说明文字，默认「登录即代表你已阅读并同意」 */
  prefix?: ReactNode;
  /** 链接后的文字（例如句号），默认空 */
  suffix?: ReactNode;
  className?: string;
}

/** 内联的「《服务条款》与《隐私协议》」文字，点击按钮打开对应文档。 */
export function LegalDocLinks({
  prefix = "登录即代表你已阅读并同意",
  suffix = null,
  className,
}: LegalDocLinksProps): ReactNode {
  const [doc, setDoc] = useState<DocKey | null>(null);
  const [about, setAbout] = useState<AboutResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // 首次打开文档时才请求（/api/about 为公开接口），避免登录页多一次请求
  useEffect(() => {
    if (!doc || about) return;
    let active = true;
    setLoading(true);
    setError(null);
    getAbout()
      .then((data) => {
        if (active) setAbout(data);
      })
      .catch(() => {
        if (active) setError("加载失败，请重试");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [doc, about, attempt]);

  const openDoc = (key: DocKey): void => {
    setDoc(key);
  };

  const close = (): void => {
    if (loading) return;
    setDoc(null);
  };

  const text = about && doc ? (doc === "privacy" ? about.privacy : about.terms) : "";
  const updatedAt = about && doc ? (doc === "privacy" ? about.privacyUpdatedAt : about.termsUpdatedAt) : "";

  return (
    <>
      <span className={className}>
        {prefix}《
        <button
          type="button"
          className="font-medium text-text underline decoration-line underline-offset-2 transition active:text-brand"
          onClick={() => openDoc("terms")}
        >
          服务条款
        </button>
        》与《
        <button
          type="button"
          className="font-medium text-text underline decoration-line underline-offset-2 transition active:text-brand"
          onClick={() => openDoc("privacy")}
        >
          隐私协议
        </button>
        》
        {suffix}
      </span>

      <Dialog
        open={doc !== null}
        onClose={close}
        title={doc ? DOC_TITLES[doc] : ""}
        description={updatedAt ? `最后更新 ${updatedAt}` : undefined}
        footer={
          <button type="button" className="btn btn-secondary btn-block" onClick={close} disabled={loading}>
            关闭
          </button>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Spinner size={18} />
            正在加载…
          </div>
        ) : error ? (
          <div className="space-y-3 py-2">
            <p className="text-sm leading-relaxed text-danger">{error}</p>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => {
                setAbout(null);
                setAttempt((value) => value + 1);
              }}
            >
              重试
            </button>
          </div>
        ) : (
          <div className="max-h-[60dvh] overflow-y-auto pr-1 text-sm leading-relaxed text-text watch:text-[12px]">
            <Markdown text={text || "内容不可用。"} />
          </div>
        )}
      </Dialog>
    </>
  );
}
