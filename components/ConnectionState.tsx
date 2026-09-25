"use client";

import { createContext, useContext } from "react";

export type ConnectionStatus = "checking" | "connected" | "disconnected" | "error";

export const ConnectionContext = createContext<{
  status: ConnectionStatus;
  retry: () => void;
}>({ status: "checking", retry: () => {} });

export function useConnection() {
  return useContext(ConnectionContext);
}
