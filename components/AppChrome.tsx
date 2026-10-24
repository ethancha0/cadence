"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Nav } from "@/components/Nav";
import { SwitchOverlay } from "@/components/SwitchOverlay";
import { StoreProvider } from "@/lib/store";

const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

/** App shell: data store, nav, and the hard-stop overlay (on every page except sign-in). */
export function AppChrome({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (AUTH_PATHS.includes(path)) return children;
  // The desktop overlay is its own small window: no nav, and it shows the hard stop itself.
  if (path === "/overlay") return <StoreProvider poll={15_000}>{children}</StoreProvider>;
  return (
    <StoreProvider>
      <Nav />
      <ErrorBanner />
      <main className="main">{children}</main>
      <SwitchOverlay />
    </StoreProvider>
  );
}
