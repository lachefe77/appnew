# Legacy release audit map

The original release is an obfuscated Chrome extension. `audit/formatted/` was
generated from the archive with Prettier so each file can be searched and
reviewed. It is not decompiled source code.

## Runtime entry points

| Archived path | Role | Clean-room status |
| --- | --- | --- |
| `js-clean/service-worker.js` | Background orchestration | Do not reuse |
| `js-clean/page-hook.js` | Main-world page interception | Do not reuse |
| `js-clean/collector.js` | Page/content bridge | Do not reuse |
| `js-clean/popup.js` | Popup UI | Requirements only |
| `js-clean/_local-bypass.js` | License and remote API bypass | Remove permanently |
| `js-clean/core-loader.js` | Dynamic script injection | Do not reuse |

## Prohibited legacy behaviors

- Faking, bypassing, or weakening authorization and licensing checks.
- Capturing or forwarding browser authentication material.
- Changing Origin/Referer headers, using a browser-wide proxy, or hiding traffic.
- Calling undocumented betting-provider APIs or submitting bets automatically.
- Sending license keys, device identifiers, location, or betting data to telemetry
  without an explicit documented contract and user consent.

## Deobfuscation status

All archived JavaScript, HTML, CSS, and JSON files are formatted in
`audit/formatted/`. The remaining identifier and control-flow obfuscation cannot
be safely reversed mechanically; it requires per-module behavioral review. The
new extension must be implemented from documented requirements instead of
transplanting behavior from that release.
