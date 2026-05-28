## Resilience — Polly v8 + Typed HttpClients

---

### The Pattern
Every external HTTP call goes through a typed client.
Typed clients are registered with resilience pipelines.
Never use `HttpClient` or `IHttpClientFactory` directly in application code.

---

### Typed Client Registration
```csharp
// Registration in DI (Program.cs or extension method)
builder.Services.AddHttpClient<IInventoryServiceClient, InventoryServiceClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Services:Inventory:BaseUrl"]!);
    client.DefaultRequestHeaders.Add("Accept", "application/json");
})
.AddResilienceHandler("inventory-pipeline", pipelineBuilder =>
{
    pipelineBuilder
        .AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 3,
            Delay = TimeSpan.FromMilliseconds(500),
            BackoffType = DelayBackoffType.Exponential,
            UseJitter = true,
            ShouldHandle = args => args.Outcome switch
            {
                { Exception: HttpRequestException } => PredicateResult.True(),
                { Result.StatusCode: >= HttpStatusCode.InternalServerError }
                    => PredicateResult.True(),
                { Result.StatusCode: HttpStatusCode.TooManyRequests }
                    => PredicateResult.True(),
                _ => PredicateResult.False()
            }
        })
        .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.5,
            MinimumThroughput = 10,
            SamplingDuration = TimeSpan.FromSeconds(30),
            BreakDuration = TimeSpan.FromSeconds(30),
            OnOpened = args =>
            {
                _logger.LogWarning(
                    "Circuit breaker opened for Inventory service. Duration: {Duration}",
                    args.BreakDuration);
                return ValueTask.CompletedTask;
            }
        })
        .AddTimeout(TimeSpan.FromSeconds(10));
});
```

---

### Typed Client Interface and Implementation
```csharp
public interface IInventoryServiceClient
{
    Task<InventoryResponse?> GetInventoryAsync(
        string productId, CancellationToken ct);

    Task<ReservationResponse> ReserveStockAsync(
        ReserveStockRequest request, CancellationToken ct);
}

public sealed class InventoryServiceClient(HttpClient httpClient)
    : IInventoryServiceClient
{
    public async Task<InventoryResponse?> GetInventoryAsync(
        string productId, CancellationToken ct)
    {
        using var activity = ActivitySources.InventoryClient
            .StartActivity("GetInventory");
        activity?.SetTag("product.id", productId);

        var response = await httpClient.GetAsync(
            $"/api/v1/inventory/{productId}", ct);

        if (response.StatusCode == HttpStatusCode.NotFound)
            return null;

        response.EnsureSuccessStatusCode();

        return await response.Content
            .ReadFromJsonAsync<InventoryResponse>(ct);
    }
}
```

---

### Resilience Pipeline Naming Conventions
- Named pipelines live in a `ResiliencePipelines` static class or similar
- Read the existing pipeline names before creating new ones
- Pipeline names should reflect the downstream service: `"inventory-pipeline"`,
  `"payment-pipeline"` — not generic names like `"default"`

---

### What NOT to Retry
```csharp
ShouldHandle = args => args.Outcome switch
{
    // Retry transient failures
    { Exception: HttpRequestException } => PredicateResult.True(),
    { Exception: TaskCanceledException { InnerException: TimeoutException } }
        => PredicateResult.True(),
    { Result.StatusCode: >= HttpStatusCode.InternalServerError }
        => PredicateResult.True(),
    { Result.StatusCode: HttpStatusCode.TooManyRequests }
        => PredicateResult.True(),

    // Do NOT retry client errors — they will not succeed on retry
    { Result.StatusCode: >= HttpStatusCode.BadRequest
        and < HttpStatusCode.InternalServerError }
        => PredicateResult.False(),

    _ => PredicateResult.False()
}
```

Never retry 4xx responses except 429 (rate limiting).

---

### Observability on Resilience Events
Polly v8 emits metrics and traces automatically if OpenTelemetry is configured.
Confirm OTel is configured to include Polly — read Program.cs:
```csharp
// Should already be present in the OTel setup
.AddSource("Polly")
```

Add manual logging for circuit breaker state changes only —
do not log every retry attempt at Information level (too noisy), use Debug.

---

### Cancellation Tokens
- Always pass `CancellationToken` through the entire call chain
- Never ignore cancellation: `ct` goes to `HttpClient`, `DbContext`, everywhere
- Do not use `CancellationToken.None` unless you have an explicit reason

---

### What to verify after resilience changes
1. Does every new external call go through a typed client?
2. Is the typed client registered with a resilience handler?
3. Does the retry policy exclude 4xx responses?
4. Is the circuit breaker logging state changes?
5. Is the cancellation token passed all the way through?
6. Is the ActivitySource used in the client implementation?