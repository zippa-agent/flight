# Flight Architecture

## Durable Unit

The durable unit is a Flue agent instance:

```text
agent module: tinyfat
instance id:  <tinyfat-agent-id>--<scope-kind>--<base64url(scope-id)>
```

The TinyFat agent ID remains the parent product identity. The scope selects the
relationship-local memory boundary.

Examples:

- `agent:6884... -- channel -- telegram:-100123`
- `agent:6884... -- thread -- slack:C123:1779777014.658729`
- `agent:6884... -- embed-session -- site:docs:visitor-123`
- `agent:6884... -- support-ticket -- zendesk:ticket:987`
- `agent:6884... -- email-thread -- resend:thread:abc`

## Scope Model

Flight scopes are policy objects, not just names. A scope records:

- parent TinyFat agent ID
- relationship kind and stable relationship ID
- inbound surface and provider
- actor identity safe for model context
- channel or thread locator safe for outbound trusted code
- optional scope-local instructions

Provider credentials, webhook secrets, reply URLs, short-lived tokens, raw
request bodies, and untrusted provider capabilities stay outside model context.

## Subagents

Flue subagents are delegated child sessions. They are useful for focused tasks:

- relationship-context lookup
- support classification
- landing-page/doc-site answering
- outbound-response review

They are not the same thing as TinyFat relationship scopes. Flight uses scopes
to choose the durable instance, then lets that instance delegate to Flue
subagents when useful.

## Container Boundary

The container is a tool backend. Flight should prefer edge-native tools first:

- scoped workspace read/write/edit
- managed preview deploys
- provider SDK reply tools
- support-ticket APIs

Host tools wake Crawdad or another container backend only when needed:

- bash
- arbitrary MCP tools that require Linux state
- browser automation
- package installation

Operator tokens are Worker-side configuration only. They must never be included
in model context, dispatched input, callback URLs, container environment, or any
agent-readable state.

## UI Protocol

Flight adopts Flue's durable stream protocol. The dashboard and embed widget
should consume:

- `POST /agents/tinyfat/:instanceId` for direct prompts
- `GET /agents/tinyfat/:instanceId?offset=-1&tail=100`
- `GET /agents/tinyfat/:instanceId?offset=<offset>&live=sse`

The compatibility layer may translate older TinyFat/Crawdad stream events during
migration, but new Flight UI work should use `@flue/react` and `@flue/sdk`.
