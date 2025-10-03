import { useEffect, useRef, useState } from "react";

export function useWebSocket<T>(onMessage: (data: T) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[Dashboard] WebSocket connected");
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[Dashboard] WebSocket received message:", data.type);
        onMessageRef.current(data);
      } catch (error) {
        console.error("[Dashboard] WebSocket parse error:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("[Dashboard] WebSocket error:", error);
      setIsConnected(false);
    };

    ws.onclose = (event) => {
      console.log("[Dashboard] WebSocket closed - Code:", event.code, "Reason:", event.reason);
      setIsConnected(false);
    };

    return () => {
      console.log("[Dashboard] WebSocket cleanup - closing connection");
      ws.close();
    };
  }, []);

  return { isConnected, ws: wsRef.current };
}
