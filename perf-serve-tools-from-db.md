# Perf: Serve `tools/list` from the DB tools table (Layer 0)

**Status:** design (implementation follows)
**Branch:** `perf/serve-tools-from-db` (off `origin/ai-dev`)
**Owner:** perf team

## Problem

`tools/list` currently fans out to every backend MCP server in the namespace, does a real
MCP handshake per server, and waits for the slowest. With 45 servers, the hot path is
latency-bound on the slowest cold backend and can exceed Bifrost's ~170s deadline.

## Goal

Make the hot path a **fast DB read** instead of a backend fan-out:

1. **Background sync loop** keeps the `tools` table fresh (fetch tools/list per server,
   upsert + delete-obsolete) without blocking any request.
2. **`tools/list` reads from the DB** for the namespace — one indexed query — and returns
   in **ms**.
3. **TTL / staleness model**: a server's cached tools are considered fresh for a TTL
   (default 60s). If stale, the server is marked PENDING and (a) a background refresh is
   triggered and (b) the last-known tools are served from DB (stale-serving) so the
   namespace is never empty.
4. **Fallback**: if a server has no DB cache at all (never synced / sync failed), the
   handler does a one-off bounded backend fetch (existing per-server timeout) for just that
   server — not the whole namespace.

## Why the DB is viable

- `tools` is keyed by `mcp_server_uuid` with an index (`tools_mcp_server_uuid_idx`) and a
  unique (server, name) constraint.
- `namespace_tool_mappings` joins tools → namespaces (with override fields, indexed by
  namespace).
- Already 478 tools across 28 servers in the DB — the current `tools/list` already writes
  them; we just stop doing it on the hot path.
- `toolsSyncCache` (hash per server) already exists; `tools.repo` has `syncTools()`,
  `bulkUpsert()`, `deleteObsoleteTools()`. `filterOutOverrideTools()` and
  `toolsImplementations.sync()` exist for the sync path.

## Design

### New module: `background-tools-sync.ts`

```
class BackgroundToolsSync {
  syncIntervalMs       // default 60s
  syncTimeoutMs        // per-server fetch timeout (reuse MCP_STDIO_CONNECT_TIMEOUT_MS)
  loop()               // every interval, for each namespace:
    getMcpServers(ns, includeInactiveServers=false)  // DB, ACTIVE only
    for each server:
      // skip if cached & fresh (toolsSyncCache + a lastSyncedAt map)
      // else: fetch tools/list (bounded), filter overrides, toolsRepository.syncTools()
  start()/stop()
}
singleton: backgroundToolsSync
```

- **Idempotent** — uses `toolsSyncCache.hasChanged()` so unchanged servers skip the write.
- **Non-blocking** — runs in background; never on the request path.
- **Spawns bounded** — reuses the pool's `MCP_SPAWN_CONCURRENCY` gate so the loop can't
  cold-start 45 processes at once.
- **Kicks on demand** — a `tools/list` that finds a stale/absent server calls
  `backgroundToolsSync.ensureFresh(serverUuid)` (debounced) to pull it in soon, but the
  request itself returns from DB immediately.

### `tools/list` handler change (metamcp-proxy.ts)

Replace the synchronous backend fan-out with:

```
1. dbTools = readToolsForNamespace(namespaceUuid)   // join tools x namespace_tool_mappings
   // quick, indexed, ms
2. If any server in the namespace has a STALE or ABSENT cache:
     - mark those servers PENDING in _meta.pending
     - trigger backgroundToolsSync.ensureFresh(serverUuid)  // async, non-blocking
3. Build the Tool[] response from dbTools (apply overrides/middleware).
   - Include tools from cached servers normally.
   - For STALE servers: serve last-known tools (stale-serving) + mark PENDING.
   - For ABSENT servers (never synced): do a one-off bounded backend fetch for JUST that
     server (existing per-server timeout), and if it fails, exclude + mark PENDING.
4. Return { tools, _meta: { pending } }
```

- **Short-TTL in-memory cache** of the whole DB read (30–60s) so even the DB read isn't
  hit on every request (and so a burst of Bifrost retries doesn't re-query each time).
- **`_meta.pending`** is already supported by the client (Bifrost treats missing as
  PENDING and retries); reuse it.

### Staleness / TTL model

- Per-server `lastSyncedAt` in memory + persisted `tools.updated_at` as the source of truth.
- TTL default 60s (env `MCP_TOOLS_TTL_MS`).
- **Stale** = `now - lastSyncedAt > TTL` → serve last-known + refresh in background.
- **Absent** = no rows for the server → one-off bounded fetch (fallback).

### New repo method: `readToolsForNamespace`

```
SELECT t.*, ntm.status, ntm.override_*
FROM tools t
JOIN namespace_tool_mappings ntm ON ntm.tool_uuid = t.uuid
WHERE ntm.namespace_uuid = :ns
  AND ntm.status = ACTIVE
  AND t.mcp_server_uuid IN (SELECT mcp_server_uuid FROM namespace_server_mappings
                            WHERE namespace_uuid = :ns AND status = ACTIVE)
ORDER BY t.name
```

This gives the fully-scoped, override-aware tool list in one query — no backend I/O.

## Belt-and-suspenders (fits on top)

- **Per-server timeout** on any remaining backend fetch (one-off fallback / background
  sync) — reuse the `MCP_STDIO_CONNECT_TIMEOUT_MS` knob.
- **Total ceiling** on the aggregate — a PENDING/absent server can't stall the response.
- **Quiet DEGRADED logging** — aggregate per-namespace DEGRADED instead of per-uuid WARN.
- **Circuit breaker** per backend — N consecutive timeouts → cooldown window, exclude from
  sync loop (prevents hammering a dead backend).
- **Persist npx/uv caches** on a volume (trivial, planned separately).

## Why this fixes the churn

Bifrost's 8 MCP clients each `tools/list` and retry on timeout. With serve-from-DB,
`tools/list` returns in ms → clients go healthy → no reconnect storm. The background sync
keeps the DB fresh without ever blocking a request.

## Notes / non-goals

- Do NOT reimplement the existing backend-fetch fan-out; only keep a bounded one-off path
  for absent servers.
- Do NOT change the client-facing tool-name format (`server__tool`).
- The `namespace_tool_mappings` write path already exists (namespaces.repo) — sync just
  needs to keep it in step when a server's tools change (the current `tools/list` path
  already calls `toolsImplementations.sync`, so reuse that for the background loop).
