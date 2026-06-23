import { MapPin, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState } from "react";

//todo: remove mock functionality
const mockLocations = [
  { id: "1", name: "Main Warehouse", city: "New York" },
  { id: "2", name: "East Branch", city: "Boston" },
  { id: "3", name: "West Coast Hub", city: "Los Angeles" },
];

export function LocationSelector() {
  const [selectedLocation, setSelectedLocation] = useState(mockLocations[0]);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2 h-10" data-testid="button-location-selector">
          <MapPin className="h-4 w-4" />
          <span className="text-sm">{selectedLocation.name}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="space-y-1">
          {mockLocations.map((location) => (
            <button
              key={location.id}
              onClick={() => {
                setSelectedLocation(location);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md hover-elevate active-elevate-2"
              data-testid={`button-location-${location.id}`}
            >
              <div className="flex flex-col items-start gap-0.5">
                <span className="text-sm font-medium">{location.name}</span>
                <span className="text-xs text-muted-foreground">{location.city}</span>
              </div>
              {selectedLocation.id === location.id && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
