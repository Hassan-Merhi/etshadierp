---
name: Replit full-screen port mapping
description: Full-screen preview URLs with an explicit :5000 port must map that external port to the app's actual listener.
---

The public development URL's explicit port is controlled by the `.replit` externalPort mapping. A stale mapping of external `5000` to an internal proxy port can produce `426 Upgrade Required`; map external `5000` directly to the web app's listener instead.

**Why:** The normal local preview can return 200 while the browser's full-screen URL fails because it uses a different externally mapped port.

**How to apply:** When full-screen preview shows `Upgrade Required`, compare the URL port with `.replit` mappings and test both the local listener and the mapped external URL before changing application code.