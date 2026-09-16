"use client";

import { useSyncExternalStore } from "react";

export const ACTIVITY_NOTIFICATIONS_KEY = "ol:activity-notifications";

const listeners = new Set<() => void>();
let inMemoryEnabled = true;
let memoryOnly = false;

/** On unless this browser turned it off: live activity is the social proof of engagement. A denied storage write still takes effect for the current page. */
export function getActivityNotifications(): boolean {
  if (typeof window === "undefined") return true;
  if (memoryOnly) return inMemoryEnabled;
  try {
    inMemoryEnabled = window.localStorage.getItem(ACTIVITY_NOTIFICATIONS_KEY) !== "0";
  } catch {
    memoryOnly = true;
  }
  return inMemoryEnabled;
}

export function getActivityNotificationsServer(): boolean {
  return true;
}

function onStorage(event: StorageEvent): void {
  if (event.key !== ACTIVITY_NOTIFICATIONS_KEY && event.key !== null) return;
  try {
    if (event.storageArea !== window.localStorage) return;
  } catch {
    return;
  }
  memoryOnly = false;
  inMemoryEnabled = event.key === null || event.newValue !== "0";
  for (const listener of listeners) listener();
}

export function subscribeActivityNotifications(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** False once this browser has refused storage: the choice then lasts only for the current page. */
export function activityPreferenceSaved(): boolean {
  return !memoryOnly;
}

export function setActivityNotifications(enabled: boolean): void {
  if (typeof window === "undefined") return;
  inMemoryEnabled = enabled;
  try {
    window.localStorage.setItem(ACTIVITY_NOTIFICATIONS_KEY, enabled ? "1" : "0");
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  for (const listener of listeners) listener();
}

/** The server and hydration snapshots use the default (on); a saved "off" follows after hydration. */
export function useActivityNotifications(): boolean {
  return useSyncExternalStore(subscribeActivityNotifications, getActivityNotifications, getActivityNotificationsServer);
}
