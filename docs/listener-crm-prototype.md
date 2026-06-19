# Flight Listener CRM Prototype

Flight listener ingress stores inbound email and phone messages before any agent
turn. The delivery-time policy is a single boolean:

```json
{ "prompt_on_delivery": false }
```

- `false`: store the message, mark the thread unread, and return without
  prompting the agent. A later manual or scheduled review turn can inspect
  unread threads with `list_channels` and `read_thread`.
- `true`: store the message, mark the thread unread, and immediately submit a
  Flight turn scoped to that event/thread.

Read state is intentionally agent-directed. `read_thread` is read-only by
default. The agent can explicitly pass `mark: "read"` after it has handled a
thread, or `mark: "unread"` to keep/reopen it.

## Storage

Flight appends durable thread events into the agent workspace R2 bucket:

- `.flight/email-thread-events/`
- `.flight/phone-thread-events/`
- `.flight/listener-thread-state.json`

The listener state sidecar tracks only `read: true | false` plus small preview
metadata. It is not the source transcript; the append-only ledgers are.

## Policy Sources

Crawdad can pass policy to Flight with `x-flight-prompt-on-delivery`.

Agent secret keys supported by the Crawdad queue bridge:

- `listener_prompt_on_delivery`
- `prompt_on_delivery`
- `email_prompt_on_delivery`
- `phone_prompt_on_delivery`
- `slack_prompt_on_delivery`
- `listener_email_prompt_on_delivery`
- `listener_phone_prompt_on_delivery`
- `listener_slack_prompt_on_delivery`

Phone-number-specific policy can live in `messaging_senders.settings` as
`prompt_on_delivery` or `listener_prompt_on_delivery`; Crawdad forwards it in
the normalized phone payload.

For compatibility, existing Flight email and Slack default to prompting on
delivery unless an explicit policy says otherwise. New Flight phone ingress
defaults to no prompt.

## Twilio Prototype

1. Buy one MMS-capable Twilio number.
2. Set the Twilio incoming message webhook to:

   ```text
   https://crawdad.tinyfat.com/messaging/twilio/webhook
   ```

3. Create a `messaging_senders` row for the Twilio number, mapped to the Flight
   agent. Set `settings.prompt_on_delivery` to `false` for passive listener
   mode.
4. Send a 1:1 SMS and verify it appears at:

   ```text
   https://flight.tinyfat.com/agents/<agent-id>/listener
   ```

5. Smoke-test group MMS separately before promising group-thread behavior.

Twilio phone numbers participate in SMS/MMS, not iMessage. Outbound sending
from US long codes has A2P 10DLC compliance requirements, so this prototype
keeps phone threads listener-only until outbound policy and registration are
deliberately configured.
