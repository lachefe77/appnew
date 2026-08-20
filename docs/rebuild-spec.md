# Clean rebuild specification

This is a requirements-oriented starting point, not a port of the archived
implementation. It maps the legitimate user-facing concepts observed in the
release into independently implementable modules.

## Product modules

| Module | User outcome | Initial implementation |
| --- | --- | --- |
| Requirements | Record and prioritize rebuild work | Local editable list |
| Settings | Keep user preferences on the device | Typed local storage schema |
| Status | Explain whether the extension is ready | Local status label |
| Notifications | Tell the user about relevant events | Design interface only |
| Data providers | Read data from authorized sources | Adapter interface only |
| Audit log | Let users inspect local actions | Design interface only |

## Feature contract template

Every new feature must state:

1. The user outcome and acceptance criteria.
2. The data it reads and stores.
3. The required Chrome permissions and host permissions.
4. The documented API contract, when an external service is involved.
5. Failure behavior, privacy impact, and tests.

## Suggested build order

1. Define visual identity, supported Chrome versions, and privacy policy.
2. Add settings validation and an import/export flow.
3. Implement a read-only provider using a documented, authorized API.
4. Add activity history and notifications for read-only events.
5. Add end-to-end tests for each permitted host and interaction.

No feature should be added merely because the legacy release implemented it.
The new product needs an explicit, testable requirement and a supported contract.
