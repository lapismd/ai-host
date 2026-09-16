export function shutdownSignal() {
  const controller = new AbortController();
  const finish = () => controller.abort();
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
  return {
    signal: controller.signal,
    dispose() {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
    },
  };
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
