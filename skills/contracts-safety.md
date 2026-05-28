## Shared Contracts Library — Mandatory Protocol

The shared contracts NuGet package source lives locally.
Before touching ANY consumer, publisher, or message handler:

1. Find the contracts source path in CONTEXT.md under "Contracts Source Path"
2. Read the actual message type you are working with from that source
3. Read the version referenced in this service's .csproj
4. Compare — if the local source has fields/properties not in the referenced version, STOP
   and report: "Contracts library has changed since this service was last updated.
   Current reference: [version]. Local source appears to be: [what you see].
   Proceeding may produce incorrect code."

When writing a consumer:
- Read the message type fully before writing the Consume method
- Every property you use in the handler must exist on the actual contract type
- Do not assume optional fields are present — check nullability on the source type

When a contracts version bump is needed:
- Do not bump it silently
- Say explicitly: "This change requires updating the contracts reference from X to Y.
  This will affect [list other services that consume this message type based on CONTEXT.md]"
- Never modify the contracts source directly unless explicitly asked