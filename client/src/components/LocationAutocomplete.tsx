import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Location {
  id: number;
  code: string;
  name: string;
}

interface LocationAutocompleteProps {
  value: number;
  onChange: (locationId: number, locationName: string) => void;
  locations: Location[];
  onFocus?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  onTab?: () => void;
  onEnter?: () => void;
  rowIndex?: number;
  placeholder?: string;
  testId?: string;
}

export function LocationAutocomplete({
  value,
  onChange,
  locations,
  onFocus,
  onArrowUp,
  onArrowDown,
  onArrowLeft,
  onArrowRight,
  onTab,
  onEnter,
  placeholder = "Type location...",
  testId,
}: LocationAutocompleteProps) {
  const [searchTerm, setSearchTerm] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedLocation = locations.find((loc) => loc.id === value);
  const displayValue = searchTerm !== null ? searchTerm : selectedLocation ? selectedLocation.name : "";

  const sortedLocations = [...locations].sort((a, b) => a.name.localeCompare(b.name));

  const filteredLocations =
    searchTerm !== null && searchTerm.length > 0
      ? sortedLocations.filter((loc) => loc.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : sortedLocations;

  const handleSelect = (location: Location) => {
    onChange(location.id, location.name);
    setSearchTerm(null);
    setIsOpen(false);
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (isOpen) {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredLocations.length - 1));
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
      if (isOpen && filteredLocations.length > 0) {
        e.preventDefault();
        handleSelect(filteredLocations[selectedIndex]);
      } else if (onEnter) {
        e.preventDefault();
        onEnter();
      }
    } else if (e.key === "Tab") {
      if (isOpen && filteredLocations.length > 0 && searchTerm !== null && searchTerm.length > 0) {
        e.preventDefault();
        handleSelect(filteredLocations[selectedIndex]);
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

      {isOpen && filteredLocations.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {filteredLocations.map((location, index) => (
            <div
              key={location.id}
              className={cn(
                "px-3 py-2 cursor-pointer hover-elevate",
                index === selectedIndex && "bg-accent text-accent-foreground"
              )}
              onClick={() => handleSelect(location)}
            >
              {location.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
