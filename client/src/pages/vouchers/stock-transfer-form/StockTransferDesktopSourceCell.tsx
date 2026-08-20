import type { StockTransferFormModel } from "./useStockTransferFormModel";

function focusAndSelect(testId: string) {
  setTimeout(() => {
    const input = document.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    }
  }, 50);
}

export function StockTransferDesktopSourceCell({ model, index }: { model: StockTransferFormModel; index: number }) {
  const {
    transferEntries,
    activeTransferRow,
    activeFieldType,
    transferSourceSearchTerm,
    setTransferSourceSearchTerm,
    setTransferSourceHighlightedIndex,
    transferFocusIdRef,
    setActiveTransferRow,
    setActiveFieldType,
    setShowSourceSidebar,
    setShowItemSidebar,
    showSourceSidebar,
    transferSourceHighlightedIndex,
    locations,
    stockTransferForm,
    setTransferInventorySource,
    transferFields,
  } = model;

  return (
    <div className="w-28 sm:w-40 border-r h-9 sm:h-10">
      <input
        type="text"
        value={
          activeTransferRow === index && activeFieldType === "source"
            ? transferSourceSearchTerm
            : transferEntries[index]?.sourceLocationName || ""
        }
        onChange={(event) => {
          setTransferSourceSearchTerm(event.target.value);
          setTransferSourceHighlightedIndex(0);
        }}
        onFocus={() => {
          transferFocusIdRef.current += 1;
          setActiveTransferRow(index);
          setActiveFieldType("source");
          setTransferSourceSearchTerm(transferEntries[index]?.sourceLocationName || "");
          setTransferSourceHighlightedIndex(0);
          setShowSourceSidebar(true);
          setShowItemSidebar(false);
        }}
        onBlur={() => {
          const focusId = transferFocusIdRef.current;
          setTimeout(() => {
            if (transferFocusIdRef.current === focusId) {
              setActiveTransferRow(null);
              setActiveFieldType(null);
              setTransferSourceSearchTerm("");
              setShowSourceSidebar(false);
            }
          }, 250);
        }}
        onKeyDown={(event) => {
          const filteredLocations = locations
            .filter((location) => {
              if (!transferSourceSearchTerm.trim()) return true;
              const term = transferSourceSearchTerm.toLowerCase();
              return (
                (location.name || "").toLowerCase().includes(term) ||
                (location.code && location.code.toLowerCase().includes(term))
              );
            })
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

          if (event.key === "Enter" && filteredLocations.length > 0) {
            event.preventDefault();
            const location = filteredLocations[transferSourceHighlightedIndex] || filteredLocations[0];
            stockTransferForm.setValue(`entries.${index}.sourceLocationId`, location.id);
            stockTransferForm.setValue(`entries.${index}.sourceLocationName`, location.name);
            setTransferInventorySource(location.id);
            setTransferSourceSearchTerm("");
            setShowSourceSidebar(false);
            focusAndSelect(`input-item-name-${index}`);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (showSourceSidebar && filteredLocations.length > 0) {
              setTransferSourceHighlightedIndex(Math.max(0, transferSourceHighlightedIndex - 1));
            } else if (index > 0) {
              focusAndSelect(`input-source-${index - 1}`);
            }
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            if (showSourceSidebar && filteredLocations.length > 0) {
              setTransferSourceHighlightedIndex(
                Math.min(filteredLocations.length - 1, transferSourceHighlightedIndex + 1)
              );
            } else if (index < transferFields.length - 1) {
              focusAndSelect(`input-source-${index + 1}`);
            }
          } else if (event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey)) {
            event.preventDefault();
            focusAndSelect(`input-item-name-${index}`);
          }
        }}
        placeholder="Type location..."
        className="w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20"
        data-testid={`input-source-${index}`}
      />
    </div>
  );
}
