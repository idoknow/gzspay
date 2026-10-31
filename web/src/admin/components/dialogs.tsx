/**
 * 全局反馈层：轻提示（Toast）、确认对话框、文本输入对话框。
 * 通过 <FeedbackProvider> 包裹后台，页面内 useFeedback() 使用。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Field, Modal, cx } from "./ui";

export type ToastTone = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（红色主按钮） */
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  multiline?: boolean;
  /** 是否必填（必填时确定按钮在为空时禁用） */
  required?: boolean;
  initialValue?: string;
  hint?: ReactNode;
}

export interface FeedbackApi {
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  /** 确认对话框：确认返回 true，取消返回 false */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** 输入对话框：确定返回文本，取消返回 null */
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const value = useContext(FeedbackContext);
  if (!value) {
    throw new Error("useFeedback() 必须在 FeedbackProvider 内使用");
  }
  return value;
}

interface ConfirmState {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

interface PromptState {
  options: PromptOptions;
  resolve: (value: string | null) => void;
}

const TOAST_DURATION = 4200;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      toastIdRef.current += 1;
      const id = toastIdRef.current;
      setToasts((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismissToast(id), TOAST_DURATION);
    },
    [dismissToast],
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ options, resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(options.initialValue ?? "");
      setPromptState({ options, resolve });
    });
  }, []);

  const closeConfirm = useCallback(
    (result: boolean) => {
      const state = confirmState;
      setConfirmState(null);
      state?.resolve(result);
    },
    [confirmState],
  );

  const closePrompt = useCallback(
    (result: string | null) => {
      const state = promptState;
      setPromptState(null);
      setPromptValue("");
      state?.resolve(result);
    },
    [promptState],
  );

  const api = useMemo<FeedbackApi>(
    () => ({
      toast,
      success: (message: string) => toast(message, "success"),
      error: (message: string) => toast(message, "error"),
      warning: (message: string) => toast(message, "warning"),
      confirm,
      prompt,
    }),
    [toast, confirm, prompt],
  );

  const promptRequiredEmpty =
    promptState !== null &&
    promptState.options.required === true &&
    promptValue.trim() === "";

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      <div className="admin-toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cx(
              "admin-toast",
              item.tone === "success" && "is-success",
              item.tone === "error" && "is-error",
              item.tone === "warning" && "is-warning",
            )}
            role="status"
          >
            <span aria-hidden="true">
              {item.tone === "success"
                ? "✓"
                : item.tone === "error"
                  ? "✕"
                  : item.tone === "warning"
                    ? "⚠"
                    : "ⓘ"}
            </span>
            <span className="admin-toast-text">{item.message}</span>
            <button
              type="button"
              className="admin-modal-close"
              style={{ width: 22, height: 22, fontSize: 14 }}
              onClick={() => dismissToast(item.id)}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {confirmState !== null ? (
        <Modal
          title={confirmState.options.title}
          description={confirmState.options.description}
          onClose={() => closeConfirm(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => closeConfirm(false)}>
                {confirmState.options.cancelText ?? "取消"}
              </Button>
              <Button
                variant={confirmState.options.danger === true ? "danger" : "primary"}
                onClick={() => closeConfirm(true)}
                autoFocus
              >
                {confirmState.options.confirmText ?? "确认"}
              </Button>
            </>
          }
        >
          <div className="admin-text-sm admin-secondary">
            该操作将立即生效，请确认无误后继续。
          </div>
        </Modal>
      ) : null}

      {promptState !== null ? (
        <Modal
          title={promptState.options.title}
          description={promptState.options.description}
          onClose={() => closePrompt(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => closePrompt(null)}>
                {promptState.options.cancelText ?? "取消"}
              </Button>
              <Button
                variant={promptState.options.danger === true ? "danger" : "primary"}
                disabled={promptRequiredEmpty}
                onClick={() => closePrompt(promptValue.trim())}
              >
                {promptState.options.confirmText ?? "确认"}
              </Button>
            </>
          }
        >
          <Field
            label={promptState.options.label ?? "处理说明"}
            required={promptState.options.required === true}
            hint={promptState.options.hint}
          >
            {promptState.options.multiline === false ? (
              <input
                className="admin-input"
                value={promptValue}
                placeholder={promptState.options.placeholder}
                onChange={(event) => setPromptValue(event.target.value)}
                autoFocus
              />
            ) : (
              <textarea
                className="admin-textarea"
                value={promptValue}
                placeholder={promptState.options.placeholder}
                onChange={(event) => setPromptValue(event.target.value)}
                autoFocus
              />
            )}
          </Field>
          <div className="admin-text-xs admin-muted">
            说明会写入操作日志，请填写清晰的处理依据。
          </div>
        </Modal>
      ) : null}
    </FeedbackContext.Provider>
  );
}
