import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value?: string;
  onValueChange?: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextValue>({});

function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <TabsContext.Provider value={{ value: value ?? defaultValue, onValueChange }}>
      <div className={className} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: "pill" | "underline" }
>(({ className, variant = "pill", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      variant === "pill" &&
        "inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 p-1 text-muted-foreground",
      variant === "underline" &&
        "inline-flex items-center gap-1 border-b border-border bg-transparent p-0 text-muted-foreground",
      className
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }
>(({ className, value, onClick, children, ...props }, ref) => {
  const ctx = React.useContext(TabsContext);
  const active = ctx.value === value;

  return (
    <button
      ref={ref}
      type="button"
      data-state={active ? "active" : "inactive"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) ctx.onValueChange?.(value);
      }}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-40",
        "rounded-full px-4 py-1.5 text-muted-foreground hover:text-foreground",
        active && "bg-background text-foreground shadow-sm font-semibold",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value: string }
>(({ className, value, children, ...props }, ref) => {
  const ctx = React.useContext(TabsContext);

  if (ctx.value && ctx.value !== value) return null;

  return (
    <div
      ref={ref}
      data-state={ctx.value === value ? "active" : "inactive"}
      className={cn(
        "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
