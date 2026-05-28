## Background Services and Workers

---

### IHostedService vs BackgroundService
- `BackgroundService` for long-running loops — override `ExecuteAsync`
- `IHostedService` for start/stop lifecycle without a loop
- In most cases: use `BackgroundService`

```csharp
public sealed class OrderExpirationWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<OrderExpirationWorker> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Order expiration worker started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessExpiredOrdersAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Expected on shutdown — do not log as error
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "Unhandled error in order expiration worker");
                // Continue loop — worker should survive individual failures
            }

            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }

        logger.LogInformation("Order expiration worker stopped");
    }

    private async Task ProcessExpiredOrdersAsync(CancellationToken ct)
    {
        using var activity = ActivitySources.Workers
            .StartActivity("ProcessExpiredOrders");

        // Always create a scope for scoped services (DbContext, etc.)
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var expired = await db.Orders
            .Where(o => o.Status == OrderStatus.Pending
                && o.CreatedAt < DateTimeOffset.UtcNow.AddHours(-24))
            .ToListAsync(ct);

        activity?.SetTag("orders.expired.count", expired.Count);
        logger.LogInformation(
            "Processing {Count} expired orders", expired.Count);

        // process...
        await db.SaveChangesAsync(ct);
    }
}
```

---

### DbContext in Background Services
- DbContext is SCOPED — background services are SINGLETON
- NEVER inject DbContext directly into a background service
- ALWAYS use `IServiceScopeFactory` and create a scope per unit of work:
```csharp
  await using var scope = scopeFactory.CreateAsyncScope();
  var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
```
- Create a new scope per iteration or per job — not one scope for the lifetime
  of the worker

---

### Activity Lifetime in Workers
- Worker spans have a different lifetime than HTTP request spans
- Start a new Activity at the beginning of each job run:
```csharp
  using var activity = ActivitySources.Workers.StartActivity("JobName");
  activity?.SetTag("job.type", "OrderExpiration");
  activity?.SetTag("job.trigger", "scheduled");
```
- Do NOT carry over an Activity from a previous iteration
- Log the trace ID at the start of each run for correlation in SigNoz:
```csharp
  logger.LogInformation(
      "Starting job run. TraceId: {TraceId}",
      Activity.Current?.TraceId.ToString());
```

---

### Cancellation Token Handling
- `stoppingToken` is the `CancellationToken` passed to `ExecuteAsync` —
  it is cancelled when the application shuts down
- Always pass it to all async operations: `DbContext`, `HttpClient`, `Task.Delay`
- Catch `OperationCanceledException` separately from other exceptions —
  it is not an error, it is a clean shutdown
- Do not use `CancellationToken.None` inside a background service

---

### Error Handling Strategy
- Workers should survive individual failures — catch exceptions in the loop,
  log them, and continue
- `OperationCanceledException`: break the loop cleanly, do not log as error
- Transient infrastructure errors (DB unavailable): log as Warning,
  apply backoff before retrying
- Persistent errors (same error on every iteration): consider circuit breaker
  or exponential backoff to avoid log spam

```csharp
private static readonly TimeSpan[] BackoffIntervals =
[
    TimeSpan.FromSeconds(5),
    TimeSpan.FromSeconds(30),
    TimeSpan.FromMinutes(2),
    TimeSpan.FromMinutes(10),
];

// Track consecutive failures and apply backoff
```

---

### MassTransit Consumers as Workers
MassTransit consumers run as background services automatically when registered.
Do not create a separate `BackgroundService` wrapper around a consumer.
The MassTransit host manages the consumer lifecycle.

Consumer observability:
- MassTransit propagates trace context from the message headers automatically
  when OTel is configured — confirm it is configured in Program.cs:
```csharp
  .AddSource("MassTransit")
```
- Add your own spans for business logic inside the consumer,
  not for the MassTransit infrastructure part

---

### Logging Conventions for Background Services
```csharp
// Start and stop of worker — Information
logger.LogInformation("OrderExpirationWorker started");
logger.LogInformation("OrderExpirationWorker stopped");

// Each job run — Information with count/summary
logger.LogInformation(
    "Processed {Count} expired orders in {Duration}ms",
    count, elapsed.TotalMilliseconds);

// Nothing to process — Debug, not Information (avoids log spam)
logger.LogDebug("No expired orders found");

// Recoverable failure — Warning
logger.LogWarning(ex,
    "Failed to process order {OrderId}, will retry next run", orderId);

// Unhandled exception in loop — Error
logger.LogError(ex, "Unhandled error in order expiration worker");
```

---

### Health Checks for Workers
Register a health check if the worker has a meaningful health signal:
```csharp
builder.Services.AddHealthChecks()
    .AddCheck<OrderExpirationWorkerHealthCheck>("order-expiration-worker");
```

A worker is unhealthy if it has not successfully completed a run
within 2x its expected interval.

---

### What to verify after background service changes
1. Is DbContext accessed through a scope, never directly injected?
2. Is a new Activity started per job run?
3. Is OperationCanceledException handled separately from other exceptions?
4. Is the stoppingToken passed to all async calls?
5. Are log levels appropriate (no Debug in hot paths, no Info for no-ops)?
6. If it uses MassTransit internally: is the OTel source registered?