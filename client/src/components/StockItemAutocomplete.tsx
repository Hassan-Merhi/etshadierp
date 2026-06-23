import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface StockItem {
  id: number;
  name: string;
  code?: string;
}

interface StockItemAutocompleteProps {
  value: { id: number; name: string } | null;
  onChange: (stockItemId: number, stockItemName: string) => void;
  stockItems: StockItem[];
  onFocus?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  onTab?: () => void;
  onEnter?: () => void;
  onSearchChange?: (searchTerm: string) => void;
  rowIndex?: number;
  placeholder?: string;
  testId?: string;
  hideDropdown?: boolean;
}

export function StockItemAutocomplete({
  value,
  onChange,
  stockItems,
  onFocus,
  onArrowUp,
  onArrowDown,
  onArrowLeft,
  onArrowRight,
  onTab,
  onEnter,
  onSearchChange,
  placeholder = "Type item name...",
  testId,
  hideDropdown = false,
}: StockItemAutocompleteProps) {
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const displayValue = searchTerm !== null ? searchTerm : value ? value.name : "";

  const sortedItems = [...stockItems].sort((a, b) => a.name.localeCompare(b.name));

  const filteredItems =
    searchTerm !== null && searchTerm.length > 0
      ? sortedItems.filter((item) => item.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : sortedItems;

  const handleSelect = (item: StockItem) => {
    onChange(item.id, item.name);
    setSearchTerm(null);
    setIsOpen(false);
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (isOpen) {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
      } else if (onArrowDown) {
        e.preventDefault();
        onArrowDown();
      }
    } else if (e.key === "ArrowUp") {
      if (isOpen) {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (onArrowUp) {
        e.preventDefault();
        onArrowUp();
      }
    } else if (e.key === "ArrowLeft") {
      if (!isOpen && onArrowLeft) {
        e.preventDefault();
        onArrowLeft();
      }
    } else if (e.key === "ArrowRight") {
      if (!isOpen && onArrowRight) {
        e.preventDefault();
        onArrowRight();
      }
    } else if (e.key === "Enter") {
      if (isOpen && filteredItems.length > 0) {
        e.preventDefault();
        handleSelect(filteredItems[selectedIndex]);
      } else if (onEnter) {
        e.preventDefault();
        onEnter();
      }
    } else if (e.key === "Tab") {
      if (isOpen && filteredItems.length > 0 && searchTerm !== null && searchTerm.length > 0) {
        e.preventDefault();
        handleSelect(filteredItems[selectedIndex]);
      } else if (onTab) {
        e.preventDefault();
        onTab();
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setSearchTerm(null);
      setSelectedIndex(0);
    }
  };

  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const selectedElement = dropdownRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex, isOpen]);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        value={displayValue}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setIsOpen(true);
          setSelectedIndex(0);
          if (onSearchChange) onSearchChange(e.target.value);
        }}
        onFocus={() => {
          setIsOpen(true);
          if (onFocus) onFocus();
        }}
        onBlur={() => {
          setTimeout(() => {
            setIsOpen(false);
            setSearchTerm(null);
            setSelectedIndex(0);
          }, 200);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        data-testid={testId}
        className="w-full"
      />

      {isOpen && filteredItems.length > 0 && !hideDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {filteredItems.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                "px-3 py-2 cursor-pointer hover-elevate",
                index === selectedIndex && "bg-accent text-accent-foreground"
              )}
              onClick={() => handleSelect(item)}
            >
              {item.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
