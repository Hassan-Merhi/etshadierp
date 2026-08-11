---
name: POS transfer assigned-location routing
description: POS stock-transfer WhatsApp notifications must use the active POS assignment, not the transfer destination.
---

POS-created stock-transfer notifications are routed to the transfer WhatsApp mapping of the active POS user's assigned location. The transfer destination remains only the inventory/message destination; if the POS assignment is missing, skip notification rather than fall back to the destination group.

**Why:** A POS user can create a transfer between locations that differ from their configured assignment, and destination-based routing sends the notification to the wrong group.

**How to apply:** Resolve the canonical active-company POS role before sending. Keep destination-based routing only for non-POS callers.