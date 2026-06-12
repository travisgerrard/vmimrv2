"use client";

import { SWRConfig } from "swr";
import { useMemo } from "react";

function localStorageProvider() {
  if (typeof window === "undefined") return new Map();

  let map = new Map<string, unknown>();
  try {
    map = new Map<string, unknown>(JSON.parse(localStorage.getItem("app-cache") || "[]"));
  } catch {
    map = new Map<string, unknown>();
  }

  const persistCache = () => {
    try {
      localStorage.setItem("app-cache", JSON.stringify(Array.from(map.entries())));
    } catch {
      // Ignore quota/private-mode failures; SWR still keeps the in-memory cache.
    }
  };

  window.addEventListener("pagehide", persistCache);
  return map;
}

export default function SWRProvider({ children }: { children: React.ReactNode }) {
  const swrConfig = useMemo(() => ({ provider: localStorageProvider }), []);

  return (
    <SWRConfig value={swrConfig}>
      {children}
    </SWRConfig>
  );
}
