"use client";

import { useId, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Bell, Check, ShieldCheck, X } from "lucide-react";
import { activityPreferenceSaved, setActivityNotifications, useActivityNotifications } from "@/lib/launchpad/activity-preference";
import styles from "./NotificationSettings.module.css";

/** One preference for ambient activity. Your own transaction feedback cannot be muted. */
export default function NotificationSettings({ block = false }: { block?: boolean }) {
  const enabled = useActivityNotifications();
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={block}>
      <Popover.Trigger
        className={`${styles.trigger} ${block ? styles.block : ""}`}
        aria-label="Notification settings"
        title="Notification settings"
      >
        <span className={styles.bell}><Bell size={17} strokeWidth={1.8} aria-hidden />{enabled ? <span className={styles.dot} /> : null}</span>
        {block ? <><span>Notifications</span><span className={styles.triggerStatus}>{enabled ? "Live on" : "Personal only"}</span></> : null}
      </Popover.Trigger>
      <Popover.Portal>
        {block ? <Popover.Backdrop className={styles.backdrop} /> : null}
        <Popover.Positioner side="bottom" align="end" sideOffset={10} collisionPadding={12} positionMethod="fixed" className={`${styles.positioner} ${block ? styles.mobilePositioner : ""}`}>
          <Popover.Popup
            ref={popup}
            initialFocus={popup}
            className={styles.popup}
            aria-modal={block || undefined}
            onKeyDown={(event) => {
              // Dismiss this panel without also closing the mobile navigation.
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
            }}
          >
            <div className={styles.header}>
              <Popover.Title className={styles.title}>Notifications</Popover.Title>
              <Popover.Close className={styles.close} aria-label="Close notification settings"><X size={17} aria-hidden /></Popover.Close>
            </div>
            <Popover.Description className={styles.description}>Choose what interrupts your browsing.</Popover.Description>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-labelledby={`${id}-activity`}
              aria-describedby={`${id}-description`}
              className={styles.preference}
              onClick={() => setActivityNotifications(!enabled)}
            >
              <span className={styles.preferenceCopy}>
                <span id={`${id}-activity`} className={styles.label}>Live activity notifications</span>
                <span id={`${id}-description`} className={styles.help}>Popups for other traders’ launches, buys and sells.</span>
              </span>
              <span className={styles.switchControl} aria-hidden>
                <span className={styles.track}><span className={styles.thumb}>{enabled ? <Check size={12} strokeWidth={2.4} /> : null}</span></span>
                <span className={styles.switchState}>{enabled ? "On" : "Off"}</span>
              </span>
            </button>
            <div className={styles.personal}>
              <ShieldCheck size={18} strokeWidth={1.7} aria-hidden />
              <div><div className={styles.personalHeading}><span className={styles.label}>Your transactions</span><span className={styles.always}>Always on</span></div><p className={styles.help}>Confirmations and important notices still appear.</p></div>
            </div>
            <p className={styles.footer}>{activityPreferenceSaved() ? "Saved in this browser." : "This browser is blocking saved settings, so this choice lasts until you leave the page."} The activity feed stays live.</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
