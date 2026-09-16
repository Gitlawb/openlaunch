export const BRIDGE_QUOTE_DEBOUNCE_MS = 700;

type QuoteTask = (context: { signal: AbortSignal; isCurrent: () => boolean }) => Promise<void>;

/** One unsigned quote at a time. Aborted transports may still resolve, so every
 * result must also pass isCurrent before updating the form. No wallet actions. */
export function createBridgeQuoteSession() {
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  function cancel() {
    revision++;
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }

  return {
    cancel,
    schedule(request: () => void) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        request();
      }, BRIDGE_QUOTE_DEBOUNCE_MS);
      return cancel;
    },
    async run(task: QuoteTask) {
      cancel();
      const current = revision;
      const abort = new AbortController();
      controller = abort;
      await task({ signal: abort.signal, isCurrent: () => revision === current && !abort.signal.aborted });
      if (revision === current) controller = undefined;
    },
  };
}
