"use client";

import { useEffect } from "react";
import { WalletPicker } from "@/components/wallet/WalletButton";
import { WalletProvider } from "@/lib/client/wallet";

export default function ClientBody({
  children,
}: {
  children: React.ReactNode;
}) {
  // Remove any extension-added classes during hydration
  useEffect(() => {
    // This runs only on the client after hydration
    document.body.className = "antialiased";
  }, []);

  return (
    <WalletProvider>
      <div className="antialiased">{children}</div>
      <WalletPicker />
    </WalletProvider>
  );
}
