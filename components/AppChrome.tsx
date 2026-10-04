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
  return (
    <StoreProvider>
      <Nav />
      <ErrorBanner />
      <main className="main">{children}</main>
      <SwitchOverlay />
    </StoreProvider>
  );
}
