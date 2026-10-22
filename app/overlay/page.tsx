import type { Metadata } from "next";
import { DesktopOverlay } from "@/components/DesktopOverlay";

export const metadata: Metadata = {
  title: "Cadence overlay",
};

/** Loaded by the desktop shell (desktop/) into a transparent, always-on-top window. */
export default function OverlayPage() {
  return <DesktopOverlay />;
}
