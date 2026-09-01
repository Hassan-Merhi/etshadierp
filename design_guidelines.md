# ERP POS System Design Guidelines

## Design Approach

**Selected Approach:** Design System (Hybrid of Linear + Ant Design + Tailwind UI)

**Justification:** This utility-focused enterprise application prioritizes efficiency, data clarity, and learnability. The design system approach ensures consistency across modules while maintaining professional aesthetics suitable for business operations.

**Key Design Principles:**
- Clarity over decoration: Information hierarchy drives all design decisions
- Efficiency-first: Minimize clicks, maximize visibility of critical data
- Scannable layouts: Dense information presented in digestible formats
- Role-appropriate interfaces: Different user roles see optimized layouts

## Typography System

**Primary Font:** Inter (Google Fonts) - optimized for UI and data-heavy interfaces
**Secondary Font:** JetBrains Mono (Google Fonts) - for codes, barcodes, financial figures

**Hierarchy:**
- Page Titles: text-2xl font-semibold (24px, 600 weight)
- Section Headers: text-lg font-medium (18px, 500 weight)
- Card/Module Titles: text-base font-medium (16px, 500 weight)
- Body Text: text-sm font-normal (14px, 400 weight)
- Table Data: text-sm font-normal (14px, 400 weight)
- Labels/Captions: text-xs font-medium (12px, 500 weight)
- Numerical Data: font-mono text-sm (JetBrains Mono for financial figures, quantities)
- Buttons: text-sm font-medium (14px, 500 weight)

## Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, and 8 consistently
- Micro spacing: p-2, gap-2 (8px) - between related elements
- Standard spacing: p-4, gap-4 (16px) - component internal padding
- Section spacing: p-6, gap-6 (24px) - between component groups
- Major spacing: p-8, gap-8 (32px) - page sections, module separation

**Grid System:**
- Main layout: Sidebar (w-64) + Content area (flex-1)
- Dashboard cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4
- Form layouts: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6
- Tables: Full-width responsive with horizontal scroll on mobile
- Containers: max-w-7xl mx-auto for content areas

**Responsive Breakpoints:**
- Mobile: < 768px (single column, stacked components)
- Tablet: 768px-1024px (2-column layouts)
- Desktop: > 1024px (full multi-column)

## Navigation Architecture

**Global Navigation (Sidebar - Fixed Left):**
- Width: w-64 on desktop, collapsible to w-16 (icon-only) with toggle
- Mobile: Full-screen overlay drawer
- Structure: Company selector at top → Navigation groups → User profile at bottom
- Navigation items: h-10 with icon (w-5 h-5) + label, hover states
- Active state: Subtle indication with slightly elevated background
- Groups: Dashboard, POS, Inventory, Financial, Reports, Settings

**Top Bar (Fixed):**
- Height: h-16
- Left: Menu toggle (mobile) + breadcrumb navigation
- Right: Multi-company selector, location selector, theme toggle, notifications, user menu
- Search: Global search bar (max-w-md) in center on desktop

**Multi-Company/Location Selector:**
- Dropdown with search capability
- Shows: Company name, location count
- Visual indicator of active selection in top bar

## Component Library

### Dashboard Components

**KPI Cards:**
- Layout: p-6 rounded-lg border
- Structure: Label (text-xs uppercase tracking-wide) → Value (text-3xl font-bold font-mono) → Change indicator → Sparkline chart (if applicable)
- Grid: 4 columns on desktop, 2 on tablet, 1 on mobile
- Height: h-32 for consistency

**Charts:**
- Container: p-6 rounded-lg border
- Title: text-lg font-medium mb-4
- Chart area: h-64 to h-80 (depending on complexity)
- Types: Line charts (sales trends), Bar charts (comparisons), Donut charts (distribution)

**Recent Activity List:**
- Item height: h-16
- Structure: Icon (w-10 h-10 rounded) + Content (2-line: title + timestamp) + Action
- Scrollable: max-h-96 overflow-y-auto

### POS Interface (Dedicated Full-Screen Layout)

**Layout:** Split view - Products (60% width) | Cart (40% width)

**Product Grid (Left Panel):**
- Search bar: Fixed top with barcode scanner icon, h-12
- Category tabs: h-10 horizontal scroll on mobile
- Product cards: grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3
- Card: p-3 aspect-square, product image placeholder, name (text-sm truncate), price (text-lg font-mono font-semibold), stock badge

**Cart Panel (Right Panel - Fixed):**
- Header: h-16 with customer selector
- Items list: flex-1 overflow-y-auto, each item h-20 with quantity controls
- Subtotal section: border-t p-4 with line items (subtotal, tax, discount)
- Total: text-2xl font-bold font-mono
- Payment methods: Grid of buttons (Cash/Card/Mobile) h-12 each
- Complete Sale button: h-14 w-full prominent styling

### Data Tables

**Structure:**
- Container: rounded-lg border overflow-hidden
- Header: Sticky top with filters/search/actions, h-14
- Table: w-full text-sm
- Header row: h-12 font-medium, sortable columns with icons
- Data rows: h-14 hover state, striped alternate rows
- Actions column: Fixed right with icon buttons
- Pagination: h-12 flex items-center justify-between

**Table Variants:**
- Compact: h-10 rows for dense data (stock lists)
- Standard: h-14 rows for general use
- Expanded: h-16+ rows with multi-line content (container details)

### Forms

**Layout:**
- Container: max-w-4xl p-6 rounded-lg border
- Field groups: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6
- Full-width fields: col-span-full for textareas, file uploads

**Form Fields:**
- Label: text-sm font-medium mb-1.5
- Input: h-10 px-3 rounded-md border
- Textarea: p-3 rounded-md border min-h-32
- Select: h-10 rounded-md border
- Checkbox/Radio: Custom styled with labels text-sm
- File upload: h-32 border-dashed rounded-md drag-drop zone
- Barcode field: Input with scan icon button

**Validation:**
- Error states: Border indication + text-xs message below field
- Required indicators: Asterisk after label
- Helper text: text-xs mt-1

### Financial Reports

**Report Container:**
- Layout: max-w-5xl mx-auto p-8
- Header: Company info + report title + date range, pb-6 border-b
- Sections: Clear hierarchy with h-12 section headers
- Tables: Full-width with aligned columns (right-align numbers)
- Number formatting: font-mono for all financial figures
- Subtotals: font-medium border-t pt-2
- Grand totals: font-bold border-t-2 pt-3 text-lg
- Print button: Fixed top-right

### Modal Patterns

**Standard Modal:**
- Overlay: Backdrop blur
- Container: max-w-2xl rounded-lg
- Header: h-16 px-6 border-b with title + close button
- Body: p-6 overflow-y-auto max-h-96
- Footer: h-16 px-6 border-t flex justify-end gap-3

**Drawer (Side Panel):**
- Width: w-96 for forms/details
- Full height, slide from right
- Same header/body/footer structure as modal

### Excel Import/Export

**Import Interface:**
- Dropzone: h-48 border-dashed rounded-lg with upload icon
- File preview: Table showing first 5 rows for validation
- Mapping interface: Source column → Destination field with dropdowns
- Progress bar: h-2 during processing

**Export Options:**
- Button: Icon + "Export to Excel" label
- Options dropdown: Format selection, date range filter

### Buttons & Actions

**Button Sizes:**
- Small: h-8 px-3 text-xs
- Standard: h-10 px-4 text-sm
- Large: h-12 px-6 text-base

**Button Variants:**
- Primary: Solid fill for main actions
- Secondary: Border with transparent fill
- Ghost: No border/background, hover state only
- Danger: For destructive actions

**Icon Buttons:** w-10 h-10 square, icon centered (w-5 h-5)

### Icons

**Library:** Heroicons (outline for navigation/actions, solid for status indicators)
**Sizes:** w-4 h-4 (inline), w-5 h-5 (standard), w-6 h-6 (prominent)

### Alerts & Notifications

**Toast Notifications:** Fixed top-right, w-96, slide-in animation, auto-dismiss 5s
**Stock Alerts:** Inline in tables with warning icon + text-xs
**System Messages:** Full-width banner at page top, h-12

## Accessibility

- All interactive elements: min-h-10 (44px) for touch targets
- Form inputs: Proper labels, ARIA attributes, keyboard navigation
- Tables: Sortable headers with keyboard support
- Modals: Focus trap, ESC to close
- Color contrast: Text meets WCAG AA standards (handled in color implementation)

## Images

**No hero images required** - This is a business application focused on data and functionality. Images used only for:
- Product thumbnails in POS (aspect-square placeholders)
- Empty states (simple illustrations, max-w-xs)
- User avatars (w-10 h-10 rounded-full)
- Company logos (h-8 in selectors)