import { useEffect, useRef } from "react";
import html2canvas from "html2canvas";

const CAPTURE_INTERVAL_MS = 3000;

export function useScreenFeed() {
  const busyRef = useRef(false);

  useEffect(() => {
    const capture = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const canvas = await html2canvas(document.body, {
          scale: 0.5,
          useCORS: true,
          logging: false,
          allowTaint: true,
          ignoreElements: (el) => el.getAttribute("data-screenfeed-ignore") === "true",
        });
        const dataUrl = canvas.toDataURL("image/jpeg", 0.4);
        fetch("/api/screen-feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ dataUrl }),
        }).catch(() => {});
      } catch {
        // Silently ignore capture errors
      } finally {
        busyRef.current = false;
      }
    };

    const id = setInterval(capture, CAPTURE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
