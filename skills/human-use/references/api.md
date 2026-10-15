# HTTP examples

Pass every JSON body as a UTF-8 file to `node <skill-directory>/scripts/api.mjs POST <path> <file.json>`. GET responses print JSON; binary downloads require `--out <filename>`. Errors exit nonzero. No credentials are printed.

Create (`POST /api/tickets`):

```json
{
  "title": "Verify device power",
  "description": "Check the physical connections, measure voltage and attach a screenshot or photo.",
  "acceptance": "Both checks complete, 4.8–5.2 V measured, photo clearly shows the connections.",
  "source": "my-agent",
  "request_key": "device-power-001",
  "units": [
    { "id": "checks", "type": "checklist", "label": "Connections", "required": true, "items": [ { "id": "power", "label": "Power connected" }, { "id": "data", "label": "Data cable connected" } ] },
    { "id": "voltage", "type": "number", "label": "Measured voltage", "required": true, "unit": "V" },
    { "id": "notes", "type": "text", "label": "Observations", "required": false },
    { "id": "state", "type": "choice", "label": "Indicator", "required": true, "multiple": false, "options": [ { "id": "on", "label": "On" }, { "id": "off", "label": "Off" } ] },
    { "id": "photo", "type": "attachment", "label": "Photo or screenshot", "required": true }
  ]
}
```

All unit IDs must be unique simple ASCII identifiers. `description` is optional on units. Required checklists require every item. Add `{ "id": "operated_at", "type": "timestamp", "label": "Operation time", "required": true }` for a manually editable local date/time with a Get Time button. Answers use UTC ISO strings such as `2026-10-15T10:30:00.000Z`; empty optional values use `""`. Get Time fills the user's current local time without submitting. This is a user-editable observation, separate from the service-generated submission time. People may paste screenshots into attachment areas. Only the browser can save drafts, upload and submit.

Optional binding: `POST /api/bindings` with `{ "client": "generic", "session_id": "<your real session ID>", "cwd": "<absolute project directory>" }`; add the returned `id` as `binding_id` when creating a ticket. Session hook context already contains a registered ID.

Read: `GET /api/tickets?status=submitted`, `GET /api/tickets/{id}`. New submissions contain immutable `units`, `answers`, `note`, `version`, `hash` and `submitted_at`. Older snapshots without `units` retain their original hash. Attachment answers are arrays of attachment IDs. Fetch original bytes at `/api/tickets/{id}/attachments/{attachment_id}`; the service verifies SHA-256 before responding. Never-submitted uploads can be deleted by the person; evidence referenced by an existing submission is retained even if removed from a later draft.

Review (`POST /api/tickets/{id}/review`):

```json
{ "version": 1, "submission_hash": "<64-character hash read from latest submission>", "decision": "accept", "reason": "Actual answers and inspected photo satisfy the stated criteria." }
```

Use `return` with a specific reason to request corrections. Never reuse a hash after reading a newer submission. Cancel an unfinished request using `POST /api/tickets/{id}/cancel` with `revision` and `reason`.

To request new controls, add `additional_units` to a return review (also supported by MCP `review_ticket`):

```json
{
  "version": 1,
  "submission_hash": "<latest submission hash>",
  "decision": "return",
  "reason": "Please identify the device and provide a closer photo.",
  "additional_units": [
    { "id": "model", "type": "text", "label": "Device model", "required": true },
    { "id": "closeup", "type": "attachment", "label": "Connector close-up", "required": true }
  ]
}
```

The array must be nonempty and its IDs must be new. It appends requirements for the next submission, preserving old snapshots and controls. It is invalid with `accept`. Snapshot `units` participates in the new submission hash; do not reconstruct an older hash with added fields.

Activity (`POST /api/tickets/{id}/activity`):

```json
{ "type": "agent.check_completed", "message": "Voltage checked; inspecting the connection photo next.", "external_id": "voltage-check-submission-1" }
```

Other types: `agent.message`, `agent.waiting_for_approval`, `agent.turn_finished`. An activity is a notification, not an acceptance. Retry the same activity with the same external ID; changing its contents conflicts.

Events: `GET /api/events?after=0&ticket_id={id}&audience=agent` or `/api/events/wait` with the same parameters plus `timeout=20`. Responses contain `events`, `cursor` (last matching event delivered) and `latest_cursor` (global high-water mark). Carry `cursor` forward; do not skip a partially read page using `latest_cursor`. Use `binding_id` to restrict to your conversation. Event data identifies the exact submission but does not replace reading its evidence.
