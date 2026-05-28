## Error Handling

---

### The Three Error Categories
Handle each differently:

**1. Validation errors** (user input is wrong)
- Status 400, `ValidationProblemDetails`
- Never log these at Error level — they are expected
- Log at Debug or not at all

**2. Domain errors** (business rule violated)
- Status 409, 422, or 404 depending on the situation
- ProblemDetails with a meaningful `detail` field
- Log at Information level — they are business events, not failures

**3. Infrastructure errors** (database down, external service unreachable)
- Status 500
- Log at Error level with full exception
- Never expose internal exception messages to the client

---

### Domain Error Pattern
```csharp
// A typed result approach — no exceptions for expected domain failures
public sealed class Result<T>
{
    public T? Value { get; }
    public DomainError? Error { get; }
    public bool IsSuccess => Error is null;

    private Result(T value) => Value = value;
    private Result(DomainError error) => Error = error;

    public static Result<T> Success(T value) => new(value);
    public static Result<T> Failure(DomainError error) => new(error);
}

public sealed record DomainError(string Code, string Message);

// In endpoint
var result = await handler.HandleAsync(command, ct);
return result.IsSuccess
    ? TypedResults.Ok(result.Value)
    : TypedResults.Problem(
        detail: result.Error!.Message,
        statusCode: StatusCodes.Status422UnprocessableEntity,
        title: result.Error.Code);
```

If the project uses a different Result pattern, read it and use that —
do not introduce a second one.

---

### Global Exception Middleware
Unhandled exceptions are caught by `UseExceptionHandler()`.
The ProblemDetails service maps them automatically.

For custom exception types that need specific status codes:

```csharp
app.UseExceptionHandler(exceptionHandlerApp =>
{
    exceptionHandlerApp.Run(async context =>
    {
        var problemDetailsService = context.RequestServices
            .GetRequiredService<IProblemDetailsService>();

        var exceptionFeature = context.Features.Get<IExceptionHandlerFeature>();
        var exception = exceptionFeature?.Error;

        var statusCode = exception switch
        {
            NotFoundException => StatusCodes.Status404NotFound,
            ConflictException => StatusCodes.Status409Conflict,
            UnauthorizedException => StatusCodes.Status401Unauthorized,
            _ => StatusCodes.Status500InternalServerError
        };

        context.Response.StatusCode = statusCode;

        await problemDetailsService.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails =
            {
                Status = statusCode,
                Title = GetTitle(exception),
                Detail = statusCode < 500 ? exception?.Message : null,
                Extensions =
                {
                    ["traceId"] = Activity.Current?.Id
                        ?? context.TraceIdentifier
                }
            }
        });
    });
});
```

Read the existing exception handler before modifying it.

---

### MassTransit Error Handling
```csharp
// Consumer retry configuration
cfg.UseMessageRetry(r =>
{
    r.Exponential(
        retryLimit: 5,
        minInterval: TimeSpan.FromSeconds(1),
        maxInterval: TimeSpan.FromMinutes(5),
        intervalDelta: TimeSpan.FromSeconds(2));
    r.Ignore<ValidationException>();  // do not retry validation errors
});

// Delayed redelivery (longer gaps between attempts)
cfg.UseDelayedRedelivery(r =>
    r.Intervals(
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(15),
        TimeSpan.FromMinutes(30)));
```

- After all retries are exhausted, messages go to the `_error` queue
- Fault consumers receive `Fault<TMessage>` for error notification:
```csharp
  public class OrderCreatedFaultConsumer : IConsumer<Fault<OrderCreated>>
  {
      public async Task Consume(ConsumeContext<Fault<OrderCreated>> context)
      {
          _logger.LogError(
              "Order creation failed after all retries. OrderId: {OrderId}. Exceptions: {Exceptions}",
              context.Message.Message.OrderId,
              string.Join(", ", context.Message.Exceptions.Select(e => e.Message)));
      }
  }
```
- Register fault consumers same way as regular consumers

---

### Exception Types Hierarchy
Define custom exceptions in a shared location (read where they live in this service):
```csharp
// Base for expected business exceptions
public abstract class DomainException(string message) : Exception(message);

public sealed class NotFoundException(string resource, object id)
    : DomainException($"{resource} with id '{id}' was not found.");

public sealed class ConflictException(string message) : DomainException(message);

public sealed class UnauthorizedException(string message) : DomainException(message);
```

Never throw `Exception` directly — always throw a typed exception.
Never catch `Exception` broadly and swallow it — log and rethrow or return a Result.

---

### Logging on Errors
```csharp
// Infrastructure error — full exception, Error level
_logger.LogError(ex, "Failed to process order {OrderId}", orderId);

// Domain error — no exception, Information or Warning
_logger.LogWarning(
    "Order {OrderId} rejected: insufficient inventory for product {ProductId}",
    orderId, productId);

// Never log and rethrow with the same exception level — it double-counts
// Log once at the boundary where you handle it
```

---

### What to verify after error handling changes
1. Are validation errors returning 400 ValidationProblemDetails?
2. Are domain errors not leaking internal messages to the client?
3. Are infrastructure errors logged at Error level with the full exception?
4. Do MassTransit consumers have retry configuration?
5. Is the traceId included in ProblemDetails responses?