## Observability — SigNoz + OpenTelemetry

This codebase has strict, extended observability standards.
Before adding any Activity or log statement, READ an existing one in the same service
and replicate the exact pattern — ActivitySource name, tag naming convention,
span naming convention, log message structure.

### Activities
- Every significant operation gets a span — HTTP handlers, consumers, domain operations,
  background jobs, outbound calls
- Read the service's ActivitySource definition before creating spans —
  the source name is registered in DI, do not create a new one
- Span names follow a convention in this service — read existing ones before naming yours
- Tags use semantic conventions — read existing tag keys, do not invent new ones
- Always set span status on exception: `activity?.SetStatus(ActivityStatusCode.Error, ex.Message)`
- Dispose activities — always use `using` or `await using`

### Logging
- Structured logging only — no string interpolation: `Log.Information("Order {OrderId} created", id)`
  not `Log.Information($"Order {id} created")`
- Log at the right level:
  - Trace: internal loop iterations, very high frequency
  - Debug: inputs/outputs of operations during development
  - Information: business events (order created, payment processed)
  - Warning: recoverable issues, retries, fallbacks
  - Error: only for truly unhandled exceptions — not validation failures
- Include trace context in logs — the OTel logging integration does this automatically
  only if you don't swallow exceptions before they propagate
- Do not log sensitive data — no passwords, tokens, full card numbers, PII

### What to check after adding observability
- Is the ActivitySource the same instance used elsewhere in this service?
- Does the span cover the full operation including async continuations?
- Are tags consistent with what SigNoz dashboards would already be filtering on?
  (read existing tag names in the service before adding)