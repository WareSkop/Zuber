---
status: Done
prio: Prio 1
tags:
  - task
  - infrastructure
created: 2026-11-15
---

# Setup Reverse Proxy

Configure Nginx Proxy Manager or Caddy in front of Zuber (`PORT=3443`, `ENABLE_HTTPS=false`, `TRUST_PROXY=true`) with WebSocket support enabled on `/ws`.

- [x] Forward port `3443`
- [x] Enable WebSocket support
- [x] Enable Force SSL & HTTP/2
