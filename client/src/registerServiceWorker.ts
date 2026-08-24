if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch(() => {
        // Older browsers may not understand updateViaCache. Keep the original
        // registration path as a compatibility fallback.
        return navigator.serviceWorker.register("/sw.js");
      })
      .catch(() => {});
  });
}
