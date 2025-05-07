"use client";

import { SWRConfig } from "swr";
import { useEffect, useState } from "react";

function localStorageProvider() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = new Map<string, any>(JSON.parse(localStorage.getItem('app-cache') || '[]'));
  window.addEventListener('beforeunload', () => {
    const appCache = JSON.stringify(Array.from(map.entries()));
    localStorage.setItem('app-cache', appCache);
  });
  return map;
}

export default function SWRProvider({ children }: { children: React.ReactNode }) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    // Optionally, render nothing or a fallback while waiting for client
    return null;
  }

  return (
    <SWRConfig value={{ provider: localStorageProvider }}>
      {children}
    </SWRConfig>
  );
} 