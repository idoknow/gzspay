/**
 * 管理后台上下文：当前管理员身份与权限判断。
 * 页面通过 useAdmin() 读取角色，用于隐藏/禁用无权限的写操作。
 */
import { createContext, useContext } from "react";
import type { AdminIdentity } from "./types";

export interface AdminContextValue {
  /** 当前登录管理员 */
  admin: AdminIdentity;
  /** 可写操作（超级管理员 + 运营）；只读审计为 false */
  canWrite: boolean;
  /** 超级管理员 */
  isSuper: boolean;
  /** 只读审计 */
  isAuditor: boolean;
  /** 退出登录（由 AdminApp 注入） */
  logout: () => void;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

/** 读取管理员上下文；未包裹时抛出明确错误，便于开发期发现问题 */
export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error("useAdmin() 必须在管理后台布局内使用");
  }
  return value;
}
