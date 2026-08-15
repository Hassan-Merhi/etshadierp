/**
 * Full-bleed scan feedback overlays for the container loading scanner.
 *
 * Split out of FactoryContainerLoadingScan.tsx unchanged: success and hard
 * error flash centre-screen, while the two "scan again to bypass" prompts pin
 * below the header so the scanner stays visible.
 */
import type { FactoryContainerLoadingScanModel } from "./useFactoryContainerLoadingScanModel";

function CenterBanner({ className, lines }: { className: string; lines: [string, string] }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className={className}>
        <div className="text-5xl font-black tracking-wide drop-shadow-md">{lines[0]}</div>
        <div className="text-5xl font-black tracking-wide drop-shadow-md">{lines[1]}</div>
      </div>
    </div>
  );
}

function BypassBanner({ className, title, subtitle }: { className: string; title: string; subtitle: string }) {
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center pointer-events-none"
      style={{ top: "4rem" }}
    >
      <div className={className}>
        <div className="text-3xl font-black tracking-wide">{title}</div>
        <div className="text-2xl font-bold mt-1">{subtitle}</div>
      </div>
    </div>
  );
}

export function ScanOverlays({ model }: { model: FactoryContainerLoadingScanModel }) {
  return (
    <>
      {model.showScanSuccessPopup && (
        <CenterBanner
          className="bg-green-500 text-white rounded-xl px-16 py-10 shadow-2xl border-4 border-green-300 text-center"
          lines={["SCANNED", "SUCCESSFULLY"]}
        />
      )}
      {model.showScanErrorPopup && (
        <CenterBanner
          className="bg-red-600 text-white rounded-xl px-16 py-10 shadow-2xl border-4 border-red-300 text-center"
          lines={["SCAN ERROR", "TRY AGAIN"]}
        />
      )}
      {model.pendingBypassOverloadRef !== null && (
        <BypassBanner
          className="bg-orange-500 text-white rounded-xl px-12 py-6 shadow-2xl border-4 border-orange-700 text-center"
          title="QUANTITY EXCEEDED"
          subtitle="Scan again to bypass"
        />
      )}
      {model.pendingBypassBaleRef !== null && (
        <BypassBanner
          className="bg-amber-400 text-amber-950 rounded-xl px-12 py-6 shadow-2xl border-4 border-amber-600 text-center"
          title="ITEM NOT REQUESTED"
          subtitle="Scan again to bypass"
        />
      )}
    </>
  );
}
