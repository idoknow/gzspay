import { useEffect, useState } from "react";
import { cx } from "./ui";

interface AdminAvatarProps {
  /** 姓名，用于加载失败时显示首字 */
  name?: string | null;
  /** QQ 头像地址（服务端返回 qlogo 链接） */
  avatarUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
}

/**
 * 管理后台头像：优先显示 QQ 头像，加载失败或没有地址时回退到姓名首字。
 * 头像地址来自用户资料（`https://q1.qlogo.cn/...`），带 no-referrer 避免泄露 Referer。
 */
export function AdminAvatar({ name, avatarUrl, size = "sm", className }: AdminAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  const initial = (name ?? "").trim().slice(0, 1) || "?";
  const src = avatarUrl && !failed ? avatarUrl : null;

  return (
    <div className={cx("admin-avatar", size === "sm" && "admin-avatar-sm", className)} aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </div>
  );
}
