## API Design — Minimal APIs (.NET 10)

---

### Endpoint Registration Pattern
Endpoints are registered as extension methods on `RouteGroupBuilder`.
One static class per feature, matching the vertical slice:

```csharp
// Features/Orders/OrderEndpoints.cs
public static class OrderEndpoints
{
    public static RouteGroupBuilder MapOrderEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/", CreateOrder)
             .WithName("CreateOrder")
             .Produces<OrderResponse>(StatusCodes.Status201Created)
             .ProducesValidationProblem()
             .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapGet("/{id:guid}", GetOrder)
             .WithName("GetOrder")
             .Produces<OrderResponse>()
             .ProducesProblem(StatusCodes.Status404NotFound);

        return group;
    }

    private static async Task<IResult> CreateOrder(
        CreateOrderCommand command,
        ICommandHandler<CreateOrderCommand, OrderResponse> handler,
        CancellationToken ct)
    {
        var result = await handler.HandleAsync(command, ct);
        return TypedResults.Created($"/api/v1/orders/{result.Id}", result);
    }

    private static async Task<IResult> GetOrder(
        Guid id,
        IQueryHandler<GetOrderQuery, OrderResponse?> handler,
        CancellationToken ct)
    {
        var result = await handler.HandleAsync(new GetOrderQuery(id), ct);
        return result is null
            ? TypedResults.Problem(statusCode: StatusCodes.Status404NotFound)
            : TypedResults.Ok(result);
    }
}
```

Registration in Program.cs:
```csharp
app.MapGroup("/api/v1/orders")
   .MapOrderEndpoints()
   .RequireAuthorization()
   .WithTags("Orders");
```

---

### Always Use TypedResults
- `TypedResults.Ok(data)` not `Results.Ok(data)`
- `TypedResults.Created(location, data)`
- `TypedResults.NoContent()`
- `TypedResults.NotFound()`
- `TypedResults.Problem(...)` for error responses
- `TypedResults.ValidationProblem(errors)` for validation failures
- TypedResults provide compile-time OpenAPI metadata — do not bypass them

---

### Route Naming Conventions
- kebab-case for multi-word segments: `/order-items` not `/orderItems`
- Resource names are plural nouns: `/orders`, `/products`, `/users`
- Hierarchy reflects ownership: `/orders/{orderId}/items/{itemId}`
- No verbs in routes — use HTTP methods for actions:

POST   /orders           create
GET    /orders           list
GET    /orders/{id}      get one
PUT    /orders/{id}      full replace
PATCH  /orders/{id}      partial update
DELETE /orders/{id}      delete
POST   /orders/{id}/cancel   exception: actions that are not CRUD

---

### ProblemDetails (RFC 7807)
All error responses are ProblemDetails. Configuration:

```csharp
// Program.cs
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = ctx =>
    {
        ctx.ProblemDetails.Extensions["traceId"] =
            Activity.Current?.Id ?? ctx.HttpContext.TraceIdentifier;
        ctx.ProblemDetails.Extensions["service"] =
            builder.Environment.ApplicationName;
    };
});

app.UseExceptionHandler();
app.UseStatusCodePages();
```

Do not return plain string errors or custom error objects.
Always return ProblemDetails.

---

### Validation
- FluentValidation validators live in the feature folder
- Validation runs via a pipeline behavior or endpoint filter — read the existing
  setup before adding new validation
- Validation errors map to `ValidationProblemDetails` (status 400):
```json
  {
    "type": "https://tools.ietf.org/html/rfc7807",
    "title": "Validation failed",
    "status": 400,
    "errors": {
      "quantity": ["Must be greater than 0"],
      "productId": ["Required"]
    }
  }
```
- Read how FluentValidation is wired in this service before writing a validator

---

### Request and Response Shapes
- Requests: `record` types, immutable, validated at the boundary
- Responses: `record` types, only expose what the client needs — never return
  EF Core entities directly
- No nulls in responses if avoidable — use optional fields or exclude the property
- Dates: ISO 8601 string format (`DateTimeOffset.UtcNow.ToString("O")`)
  or use the serializer settings that are already configured — read them

---

### API Versioning
- Read CONTEXT.md for the versioning strategy in this service
- Do not introduce a new versioning approach
- Common pattern: URL segment (`/api/v1/`, `/api/v2/`)
- When adding to an existing version: additive changes only
  (new optional fields, new endpoints)
- When a breaking change is needed: new version — discuss, do not just do it

---

### OpenAPI / Swagger
- `.WithName()`, `.Produces<T>()`, `.ProducesProblem()` are mandatory
  on every endpoint — OpenAPI docs come from these
- `.WithSummary()` and `.WithDescription()` for non-obvious endpoints
- Do not configure Swagger UI differently per service — use the shared setup

---

### What to verify after endpoint changes
1. Does every endpoint use TypedResults?
2. Are all response types declared with .Produces<T>()?
3. Is the endpoint registered in the RouteGroupBuilder extension method?
4. Is the extension method called in Program.cs?
5. Does validation return ValidationProblemDetails, not a custom shape?