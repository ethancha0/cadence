"use client";

import { useStore } from "@/lib/store";

export function ErrorBanner() {
  const { error, clearError, reload } = useStore();
  if (!error) return null;
  return (
    <div className="wrap-guard">
      <div className="banner" role="alert">
        <span>{error}</span>
        <span className="btn-row">
          <button className="btn btn-ghost" onClick={() => void reload()}>
            Reload data
          </button>
          <button className="btn btn-ghost" onClick={clearError}>
            Dismiss
          </button>
        </span>
      </div>
    </div>
  );
}
