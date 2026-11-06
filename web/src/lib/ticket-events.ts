/**
 * 工单事件订阅：服务端在对方发消息、平台介入、资料披露审批、工单关闭时都会推 `ticket_update`，
 * 页面收到后立即刷新，不必等轮询；轮询保留作兜底（SSE 断线时仍能更新）。
 */
import { useEffect, useRef } from "react";
import { subscribeEvents } from "./api";

export interface TicketEventPayload {
  ticketId: string | null;
  orderId: string | null;
}

export function useTicketEvents(onChange: (payload: TicketEventPayload) => void): void {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(
    () =>
      subscribeEvents({
        onTicketUpdate: (payload) => handlerRef.current(payload),
      }),
    [],
  );
}
