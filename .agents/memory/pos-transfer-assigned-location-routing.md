---
name: POS transfer assigned-location routing
description: POS stock-transfer WhatsApp notifications must use the active POS assignment, not the transfer destination.
---

POS-created stock-transfer notifications are routed to the transfer WhatsApp mapping (Settings → Stock Transfers: `locations.transferWaGroupChatId`, company transfer group fallback) of the active POS user's assigned location. The transfer destination remains only the inventory/message destination; if the POS assignment is missing, skip notification rather than fall back to the destination group.

POS revision notifications follow the same rule: the revision's POS source (assigned) location's transfer group — NOT `locations.whatsappGroupChatId` (that is the POS receipts/shift-report chat, a different group), and never the destination.

**Why:** A POS user can create a transfer between locations that differ from their configured assignment, and destination-based routing sends the notification to the wrong group. Routing revisions via the POS chat assignment also lands in the wrong group — users configure the transfer group per-location under Settings → Stock Transfers and expect ALL transfer traffic there.

**How to apply:** Resolve the canonical active-company POS role before sending. Keep destination-based routing only for non-POS callers. Any new transfer/revision notification path must read `transferWaGroupChatId`, never `whatsappGroupChatId`.