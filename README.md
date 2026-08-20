# Rebuild audit workspace

This repository now preserves the supplied release in two forms:

- `legacy/obfuscated-release/`: exact extracted release for provenance.
- `audit/formatted/`: structurally formatted copy for review. Formatting improves
  indentation and syntax layout only; obfuscated identifiers and behavior remain.

Neither directory is a supported application source. In particular, the archived
release contains a license bypass, credential interception, proxy configuration,
and direct automated betting flows. They are quarantined as evidence and must not
be copied into a new implementation.

`extension/` is the clean-room Chrome Manifest V3 baseline. It is intentionally
local-only and has no host access, proxy access, credential collection, external
telemetry, or automated transactions.

## Commands

```bash
npm run check:legacy
node --check extension/popup.js
```

## Clean-room boundary

The new implementation may reuse only product requirements that can be stated
without reading or copying the archived implementation. Before adding a feature,
document its user benefit, required data, permissions, and tests. Do not add code
that bypasses licensing, captures authentication tokens, alters request headers,
uses a browser-wide proxy, or executes transactions on behalf of a user.
