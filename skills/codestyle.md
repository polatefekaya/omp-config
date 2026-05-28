## Code Style

---

### The One Meta-Rule
Code should read like a well-written sentence.
If you need a comment to explain what code does, rewrite the code.
The only acceptable comments are for WHY — never for WHAT or HOW.

Acceptable comment:
```csharp
// Garnet does not support GETDEL in cluster mode — split into GET + DEL
var value = await _cache.GetStringAsync(key, ct);
await _cache.RemoveAsync(key, ct);
```

Not acceptable:
```csharp
// Get the user from the database
var user = await _db.Users.FindAsync(id, ct);

// Check if user exists
if (user is null)
```

This applies to ALL languages in this codebase without exception.
No XML doc comments unless the project already has a documentation generation
pipeline and they are required. No `// TODO` left in committed code.
No commented-out code blocks — delete dead code, git history exists for a reason.

---

### C#

#### Types
- Explicit types always — no `var`:
```csharp
  // Wrong
  var order = await _db.Orders.FindAsync(id, ct);
  var items = new List<OrderItem>();
  
  // Right
  Order? order = await _db.Orders.FindAsync(id, ct);
  List<OrderItem> items = new();
```
- Exception: anonymous types where explicit is impossible, and
  `foreach` iteration variables where the type is obvious from the
  collection declaration on the same line — but prefer explicit even there
- Target-typed `new()` is fine — the type is already on the left:
```csharp
  List<OrderItem> items = new();
  Dictionary<string, int> counts = new();
```

#### Naming
- Types, methods, properties, events: `PascalCase`
- Private fields: `_camelCase` with underscore prefix
- Parameters and local variables: `camelCase`
- Constants: `PascalCase` (not `ALL_CAPS`)
- Interfaces: `IPascalCase`
- Generic type parameters: `T` for single, `TEntity`/`TResult` for multiple
- No abbreviations except universally understood ones (`id`, `dto`, `url`, `ct`)
- `ct` is the standard name for `CancellationToken` — always

```csharp
public sealed class OrderService
{
    private readonly IOrderRepository _orderRepository;
    private readonly ILogger<OrderService> _logger;
    private const int MaxRetryAttempts = 3;

    public OrderService(
        IOrderRepository orderRepository,
        ILogger<OrderService> logger)
    {
        _orderRepository = orderRepository;
        _logger = logger;
    }
}
```

#### Constructors — No Primary Constructors
Always use explicit constructors with private readonly fields:
```csharp
// Wrong
public sealed class OrderHandler(AppDbContext db, ILogger<OrderHandler> logger)
{
    public async Task HandleAsync(CreateOrderCommand command, CancellationToken ct)
    {
        await db.Orders.AddAsync(...);
    }
}

// Right
public sealed class OrderHandler
{
    private readonly AppDbContext _db;
    private readonly ILogger<OrderHandler> _logger;

    public OrderHandler(AppDbContext db, ILogger<OrderHandler> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task HandleAsync(CreateOrderCommand command, CancellationToken ct)
    {
        await _db.Orders.AddAsync(...);
    }
}
```

#### Expression Bodies
Use for single-expression members — not for anything that needs multiple lines:
```csharp
// Properties
public string FullName => $"{FirstName} {LastName}";
public bool IsExpired => ExpiresAt < DateTimeOffset.UtcNow;

// Simple methods
public OrderId GetId() => _id;
public void Clear() => _items.Clear();

// Read-only computed properties on records
public sealed record OrderSummary(decimal Subtotal, decimal Tax)
{
    public decimal Total => Subtotal + Tax;
}

// Do NOT use expression bodies when there is any complexity
// Wrong
public async Task<Order?> GetOrderAsync(Guid id, CancellationToken ct) =>
    await _db.Orders
        .Include(o => o.Items)
        .AsNoTracking()
        .FirstOrDefaultAsync(o => o.Id == id, ct);

// Right — block body for async/multi-step
public async Task<Order?> GetOrderAsync(Guid id, CancellationToken ct)
{
    return await _db.Orders
        .Include(o => o.Items)
        .AsNoTracking()
        .FirstOrDefaultAsync(o => o.Id == id, ct);
}
```

#### Nullability
- Nullable reference types are enabled — treat every warning as an error
- `is null` and `is not null` — never `== null` or `!= null`:
```csharp
  // Wrong
  if (order == null) return;
  if (user != null) { ... }
  
  // Right
  if (order is null) return;
  if (user is not null) { ... }
```
- Null-forgiving operator `!` only when you are provably certain and
  add a comment explaining why:
```csharp
  // Seeded in migrations, always present
  ApplicationRole adminRole = await _db.Roles
      .FirstOrDefaultAsync(r => r.Name == "Admin", ct)!;
```
- Guard clauses at the top of methods — fail fast, no deep nesting:
```csharp
  public async Task ProcessAsync(Order order, CancellationToken ct)
  {
      if (order is null) throw new ArgumentNullException(nameof(order));
      if (!order.CanBeProcessed) return;

      // main logic here, not nested
  }
```

#### Pattern Matching
Prefer pattern matching over chains of if/else and type checks:
```csharp
// Wrong
if (notification is EmailNotification)
{
    var email = (EmailNotification)notification;
    await SendEmailAsync(email.Address, email.Subject);
}
else if (notification is SmsNotification)
{
    var sms = (SmsNotification)notification;
    await SendSmsAsync(sms.PhoneNumber);
}

// Right
await (notification switch
{
    EmailNotification email => SendEmailAsync(email.Address, email.Subject),
    SmsNotification sms => SendSmsAsync(sms.PhoneNumber),
    _ => throw new UnreachableException($"Unhandled notification type: {notification.GetType().Name}")
});
```

#### Records and Sealed
- `record` for commands, queries, events, DTOs, value objects — immutable data
- `sealed` on everything that is not explicitly designed for inheritance
- Do not unseal without a reason:
```csharp
  public sealed record CreateOrderCommand(Guid ProductId, int Quantity);
  public sealed record OrderResponse(Guid Id, decimal Total, string Status);
  public sealed class OrderHandler { ... }
```

#### Collections
- Use collection expressions where the type is inferred:
```csharp
  string[] names = ["Alice", "Bob"];
  List<int> ids = [1, 2, 3];
```
- Prefer `IReadOnlyList<T>` and `IReadOnlyCollection<T>` for return types
  over `List<T>` — do not expose mutable collections from public APIs
- `IEnumerable<T>` for parameters when you only iterate
- `Array.Empty<T>()` or `[]` for empty collections — not `new List<T>()`

#### File Organization
- File-scoped namespaces — always:
```csharp
  // Wrong
  namespace Orders.Features.CreateOrder
  {
      public sealed class CreateOrderCommand { ... }
  }
  
  // Right
  namespace Orders.Features.CreateOrder;
  
  public sealed class CreateOrderCommand { ... }
```
- One type per file — file name matches type name exactly
- No `#region` — ever. If a class is large enough to need regions, split it
- No `#pragma warning disable` without a comment explaining why it is safe
- Usings inside the namespace declaration — file-scoped namespace
  puts them at the top, which is fine

#### LINQ
- Method syntax preferred over query syntax
- Do not chain more than 4-5 LINQ operations without extracting a named method
- Async LINQ (`ToListAsync`, `FirstOrDefaultAsync`) always with `ct`
- No LINQ in tight loops — be aware of deferred execution

```csharp
// Readable chain
IReadOnlyList<OrderSummary> summaries = await _db.Orders
    .Where(o => o.CustomerId == customerId)
    .Where(o => o.Status == OrderStatus.Confirmed)
    .OrderByDescending(o => o.CreatedAt)
    .Select(o => new OrderSummary(o.Id, o.Total, o.Status))
    .AsNoTracking()
    .ToListAsync(ct);
```

#### Things That Are Never Acceptable
- `dynamic`
- `object` parameters without a justified reason
- Catching `Exception` broadly and swallowing it silently
- `Thread.Sleep` — use `await Task.Delay`
- `.Result` or `.Wait()` on Tasks — always `await`
- Mutable public fields — use properties
- Empty catch blocks
- Magic numbers or strings — extract to named constants

---

### TypeScript / Frontend

#### Variables
- `const` by default — always
- `let` only when the variable is actually reassigned
- `var` never — it does not exist in this codebase

```ts
// Wrong
var count = 0
let name = 'Alice'  // if name is never reassigned

// Right
const name = 'Alice'
let count = 0  // only if count changes later
count++
```

#### Naming
- Variables, functions, parameters: `camelCase`
- Types, interfaces, classes, components, enums: `PascalCase`
- Constants that are truly global and never change: `SCREAMING_SNAKE_CASE`
- React/Solid components: `PascalCase` — always, no exceptions
- Custom hooks: `useCamelCase`
- Event handlers: `handleEventName` (not `onEventName` — that is for props):
```ts
  // Props
  type ButtonProps = { onClick: () => void }
  
  // Handler in component
  function handleClick() { ... }
  return <button onClick={handleClick} />
```
- Boolean variables and props: `is`, `has`, `can`, `should` prefix:
```ts
  const isLoading = true
  const hasPermission = false
  type ModalProps = { isOpen: boolean; canClose: boolean }
```

#### Functions
- Arrow functions for callbacks, inline handlers, and utility functions
- Named function declarations for top-level functions and components:
```ts
  // Component — named declaration
  export function OrderCard({ order }: OrderCardProps) { ... }
  
  // Utility — arrow const
  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' })
      .format(amount)
  
  // Callback — arrow inline
  items.filter(item => item.isActive).map(item => item.id)
```
- No function overloading with different argument counts — use options objects:
```ts
  // Wrong
  function createOrder(productId: string, quantity: number, note?: string) {}
  
  // Right
  type CreateOrderOptions = {
    productId: string
    quantity: number
    note?: string
  }
  function createOrder(options: CreateOrderOptions) {}
```

#### Types
- Be explicit — do not rely on inference for function return types:
```ts
  // Wrong
  async function getOrder(id: string) {
    return await api.get(`/orders/${id}`)
  }
  
  // Right
  async function getOrder(id: string): Promise<Order> {
    return await api.get<Order>(`/orders/${id}`)
  }
```
- `type` for data shapes — `interface` only for things that are implemented
- Avoid `enum` in TypeScript — use `as const` objects:
```ts
  // Wrong
  enum OrderStatus { Pending, Confirmed, Shipped }
  
  // Right
  const OrderStatus = {
    Pending: 'pending',
    Confirmed: 'confirmed',
    Shipped: 'shipped',
  } as const
  type OrderStatus = typeof OrderStatus[keyof typeof OrderStatus]
```
- Do not repeat type information in variable names:
```ts
  // Wrong
  const userArray: User[] = []
  const nameString: string = ''
  
  // Right
  const users: User[] = []
  const name: string = ''
```

#### Conditionals
- No unnecessary ternaries — if the result is `true`/`false`, return the condition:
```ts
  // Wrong
  const isValid = value > 0 ? true : false
  
  // Right
  const isValid = value > 0
```
- No nested ternaries — use if/else or early returns:
```ts
  // Wrong
  const label = status === 'active'
    ? 'Active'
    : status === 'pending'
      ? 'Pending'
      : 'Inactive'
  
  // Right
  function getStatusLabel(status: string): string {
    if (status === 'active') return 'Active'
    if (status === 'pending') return 'Pending'
    return 'Inactive'
  }
```
- `===` always — `==` never

#### Objects and Arrays
- Trailing commas on multiline — cleaner diffs
- Destructure when accessing multiple properties from the same object,
  but not when it would break reactivity (Solid) or obscure origin:
```ts
  // Fine
  const { id, name, email } = user
  
  // Too much — just use order.x
  const { id, customerId, total, status, createdAt, items, shippingAddress } = order
```
- Spread for shallow copies — never mutate objects/arrays directly:
```ts
  const updated = { ...order, status: 'confirmed' }
  const appended = [...items, newItem]
```

#### Async
- `async/await` always — no raw `.then()` chains unless working with
  `Promise.all` or similar combinators:
```ts
  // Wrong
  getOrder(id)
    .then(order => processOrder(order))
    .catch(err => handleError(err))
  
  // Right
  try {
    const order = await getOrder(id)
    await processOrder(order)
  } catch (error) {
    handleError(error)
  }
```
- `Promise.all` for parallel independent operations:
```ts
  const [order, inventory] = await Promise.all([
    getOrder(orderId),
    getInventory(productId),
  ])
```

#### Things That Are Never Acceptable
- `any`
- `// @ts-ignore` — use `// @ts-expect-error` with a comment if unavoidable
- `var`
- `==` instead of `===`
- Mutating function parameters
- Empty catch blocks that swallow errors silently
- `console.log` left in committed code
- Nested ternaries
- String concatenation with `+` when template literals are cleaner