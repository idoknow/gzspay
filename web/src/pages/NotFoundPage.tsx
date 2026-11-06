/** 404 页。 */

import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";

export function NotFoundPage(): ReactNode {
  const navigate = useNavigate();
  return (
    <div className="bg-app flex min-h-[100dvh] flex-col items-center justify-center px-6">
      <Logo size={72} />
      <p className="mt-6 text-5xl font-black tracking-tight text-brand">404</p>
      <p className="mt-2 text-sm text-muted">页面不存在或已移除</p>
      <button type="button" className="btn btn-primary mt-8 w-full max-w-[280px]" onClick={() => navigate("/trades", { replace: true })}>
        返回交易页
      </button>
    </div>
  );
}
