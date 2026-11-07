/**
 * NFC 卡片公开页：别人的手机贴一贴（或打开卡片里的链接）就能看到这张卡。
 *
 * 这里只展示脱敏后的信息（姓名、学号、校园卡号都打码），
 * 令牌可以随时在「我的卡片」里更换，换过之后旧链接立即失效。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { getPublicNfcCard } from "../lib/api";
import { errorMessage } from "../lib/http";
import type { NfcCard } from "../lib/types";

export default function NfcCardPage() {
  const { token = "" } = useParams();
  const [card, setCard] = useState<NfcCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getPublicNfcCard(token)
      .then((next) => {
        if (alive) {
          setCard(next);
          setError(null);
        }
      })
      .catch((cause) => {
        if (alive) setError(errorMessage(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <main className="page flex min-h-dvh flex-col justify-center gap-4 py-10">
      {loading ? (
        <p className="text-center text-[13px] text-muted">正在读取卡片…</p>
      ) : error || !card ? (
        <section className="card px-5 py-6 text-center">
          <p className="text-[15px] font-semibold">卡片不可用</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
            {error || "这张卡片可能已经停用，或者对方更换了链接。"}
          </p>
        </section>
      ) : (
        <>
          <section
            className="relative overflow-hidden rounded-[26px] p-5 text-white shadow-[0_26px_60px_-32px_rgba(8,12,20,0.9)]"
            style={{ background: "linear-gradient(148deg,#1b2537,#141c2b 42%,#0c111a)" }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12.5px] font-semibold tracking-[0.16em]">GZSPAY</p>
                <p className="mt-0.5 text-[8.5px] tracking-[0.26em] text-white/40">CAMPUS CARD</p>
              </div>
              <span className="rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-[10px] text-white/55">
                {card.merchant ? "商家" : "校园身份"}
              </span>
            </div>

            <div className="mt-6 flex items-center gap-3.5">
              <Avatar name={card.displayName} avatarUrl={card.avatarUrl} size={44} />
              <div className="min-w-0">
                <p className="truncate text-[17px] font-semibold">{card.displayName}</p>
                <p className="mt-0.5 text-[11px] text-white/45">学号 {card.studentNoMasked}</p>
              </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-3.5">
              <p className="text-[8.5px] tracking-[0.24em] text-white/40">校园卡号</p>
              <p className="mt-1 font-mono text-[13.5px] tracking-[0.14em] text-white/88">
                {card.cardNoMasked}
              </p>
            </div>
          </section>

          <p className="text-center text-[11.5px] leading-relaxed text-muted">
            NFC 卡片只展示脱敏信息，用于当面核对身份；收付款请让对方扫你的收付款码。
          </p>
        </>
      )}
    </main>
  );
}
