"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface PrivacyCtx {
  hidden: boolean;
  toggle: () => void;
}

const Ctx = createContext<PrivacyCtx>({ hidden: false, toggle: () => {} });

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(localStorage.getItem("privacy") === "1");
  }, []);

  function toggle() {
    setHidden((v) => {
      localStorage.setItem("privacy", v ? "0" : "1");
      return !v;
    });
  }

  return <Ctx.Provider value={{ hidden, toggle }}>{children}</Ctx.Provider>;
}

export function usePrivacy() {
  return useContext(Ctx);
}

/** Mask a pre-formatted string (e.g. "$12 345") when privacy mode is on. */
export function mask(value: string, hidden: boolean): string {
  return hidden ? "••••" : value;
}
