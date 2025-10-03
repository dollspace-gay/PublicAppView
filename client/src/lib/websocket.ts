import { useEffect, useRef, useState } from "react";

export function useEventStream<T>(onMessage: (data: T) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const sseUrl = `/api/events/stream`;
    console.log("[Dashboard] Connecting to SSE stream:", sseUrl);

    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("[Dashboard] SSE stream connected");
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current(data);
      } catch (error) {
        console.error("[Dashboard] SSE parse error:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("[Dashboard] SSE error - reconnecting automatically...", error);
      setIsConnected(false);
      // Don't close - let browser handle automatic reconnection
    };

    return () => {
      console.log("[Dashboard] SSE cleanup - closing connection");
      eventSource.close();
    };
  }, []);

  return { isConnected, eventSource: eventSourceRef.current };
}

// Keep WebSocket hook for backward compatibility (deprecated - use useEventStream)
export const useWebSocket = useEventStream;
