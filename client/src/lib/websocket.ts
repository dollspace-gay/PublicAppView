import { useEffect, useRef, useState } from "react";

export function useWebSocket<T>(onMessage: (data: T) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] Connected");
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (error) {
        console.error("[WS] Error parsing message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("[WS] Error:", error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log("[WS] Disconnected");
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [onMessage]);

  return { isConnected, ws: wsRef.current };
}
