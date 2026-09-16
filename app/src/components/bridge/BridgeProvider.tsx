"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import styles from "./BridgeDialog.module.css";

const BridgeDialog = dynamic(() => import("./BridgeDialog"), { ssr: false });
const BridgeContext = createContext<(() => void) | null>(null);

/** Mounted once for both navigation variants; closing the panel does not stop tracking. */
export function BridgeProvider({ children }: { children: React.ReactNode }) {
  const [activated, setActivated] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const show = useCallback(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActivated(true);
    setOpen(true);
  }, []);
  const restoreFocus = useCallback(() => trigger.current?.isConnected
    ? trigger.current
    : document.querySelector<HTMLButtonElement>('[aria-controls="mobile-menu"]'), []);

  return (
    <BridgeContext.Provider value={show}>
      {children}
      {activated ? <BridgeDialog open={open} onOpenChange={setOpen} restoreFocus={restoreFocus} /> : null}
    </BridgeContext.Provider>
  );
}

export function BridgeButton({ block = false, onOpen }: { block?: boolean; onOpen?: () => void }) {
  const show = useContext(BridgeContext);
  return (
    <button type="button" className={`${styles.trigger} ${block ? styles.blockTrigger : ""}`} aria-label="Bridge funds" aria-haspopup="dialog" title="Bridge between Base, Robinhood and Arc" onClick={() => { show?.(); onOpen?.(); }}>
      <ArrowLeftRight size={17} strokeWidth={1.8} aria-hidden />
      <span className={styles.triggerLabel}>Bridge</span>
      {block ? <span className={styles.triggerHint}>Base · Robinhood · Arc</span> : null}
    </button>
  );
}
