## Performance

Do not optimize blindly. Do not pessimize deliberately.
These rules prevent the known, common, expensive mistakes.
When something is slow: measure first with SigNoz traces, then fix.

---

### N+1 Queries — The Most Expensive Mistake

N+1 happens when you load a collection and then query the database
once per item inside a loop. It is silent and destroys performance at scale.

```csharp
// WRONG — 1 query for orders + N queries for customer names
IReadOnlyList orders = await _db.Orders
    .Where(o => o.Status == OrderStatus.Pending)
    .ToListAsync(ct);

foreach (Order order in orders)
{
    // This hits the database once per order
    Customer customer = await _db.Customers
        .FindAsync(order.CustomerId, ct);
    Console.WriteLine(customer.Name);
}

// RIGHT — 1 query with a join
IReadOnlyList result = await _db.Orders
    .Where(o => o.Status == OrderStatus.Pending)
    .Select(o => new OrderWithCustomer(
        o.Id,
        o.Total,
        o.Customer.Name))  // EF Core generates a JOIN
    .AsNoTracking()
    .ToListAsync(ct);
```

**Rule**: Never query inside a loop. If you see `await` inside
`foreach` over a collection that came from a database, stop — it is N+1.

Detecting N+1:
- SigNoz will show many identical short spans in a single trace
- EF Core logging in development shows repeated queries
- Any `await` inside `foreach` over a DB-loaded collection is a red flag

---

### Always Filter at the Database

```csharp
// Wrong — loads all orders into memory, filters in C#
IReadOnlyList pendingOrders = (await _db.Orders.ToListAsync(ct))
    .Where(o => o.Status == OrderStatus.Pending)
    .ToList();

// Right — filters in SQL
IReadOnlyList pendingOrders = await _db.Orders
    .Where(o => o.Status == OrderStatus.Pending)
    .AsNoTracking()
    .ToListAsync(ct);
```

Never call `.ToList()` or `.ToListAsync()` before filtering, sorting,
or projecting. Always compose the full query before materializing.

---

### Pagination

#### Keyset Pagination (Preferred)
Offset pagination (`Skip`/`Take`) degrades as the offset grows —
the database must scan and discard all preceding rows.
Keyset pagination is O(log n) regardless of page depth:

```csharp
// Wrong for large datasets — OFFSET 10000 scans 10000 rows
IReadOnlyList page = await _db.Orders
    .OrderByDescending(o => o.CreatedAt)
    .Skip(pageNumber * pageSize)
    .Take(pageSize)
    .Select(o => new OrderSummary(o.Id, o.CreatedAt, o.Total))
    .AsNoTracking()
    .ToListAsync(ct);

// Right — keyset: cursor is the last seen CreatedAt + Id
IReadOnlyList page = await _db.Orders
    .Where(o => o.CreatedAt < cursor.CreatedAt
        || (o.CreatedAt == cursor.CreatedAt && o.Id < cursor.Id))
    .OrderByDescending(o => o.CreatedAt)
    .ThenByDescending(o => o.Id)
    .Take(pageSize)
    .Select(o => new OrderSummary(o.Id, o.CreatedAt, o.Total))
    .AsNoTracking()
    .ToListAsync(ct);
```

* **PostgreSQL OR Clause Indexing Note:** Complex `OR` clauses in `.Where(...)` can bypass index optimizations under certain database planner conditions. Ensure there is a composite index on `(created_at DESC, id DESC)` in the database to support this query pattern.

Use offset pagination only for admin UIs with small, bounded datasets
where users jump to arbitrary pages. For API endpoints consumed by
frontend or mobile: keyset pagination.
---

### Avoid Loading What You Do Not Need

#### Project to Exactly What Is Required
```csharp
// Wrong — loads entire entity with all columns
Order? order = await _db.Orders
    .Include(o => o.Items)
    .FirstOrDefaultAsync(o => o.Id == id, ct);
string statusLabel = GetStatusLabel(order.Status);

// Right — load only what the operation uses
string? status = await _db.Orders
    .Where(o => o.Id == id)
    .Select(o => o.Status.ToString())
    .AsNoTracking()
    .FirstOrDefaultAsync(ct);
```

#### Do Not Count by Loading
```csharp
// Wrong — loads all items into memory to count them
int count = (await _db.Orders.ToListAsync(ct)).Count;

// Right — COUNT(*) in SQL
int count = await _db.Orders.CountAsync(ct);

// Existence check — even cheaper than COUNT
bool exists = await _db.Orders
    .AnyAsync(o => o.CustomerId == customerId, ct);
```

---

### Streaming Large Datasets

When processing large result sets, do not load everything into memory.
Use `IAsyncEnumerable<T>` to stream and process row by row:

```csharp
// Wrong — loads 500k rows into memory
IReadOnlyList allOrders = await _db.Orders
    .Where(o => o.CreatedAt > cutoff)
    .ToListAsync(ct);

foreach (Order order in allOrders)
{
    await ProcessOrderAsync(order, ct);
}

// Right — streams rows, processes one at a time
IAsyncEnumerable orderStream = _db.Orders
    .Where(o => o.CreatedAt > cutoff)
    .AsNoTracking()
    .AsAsyncEnumerable();

await foreach (Order order in orderStream.WithCancellation(ct))
{
    await ProcessOrderAsync(order, ct);
}
```

---

### C# Collections and Algorithms

#### Use the Right Data Structure
```csharp
// Searching a List is O(n) — fine for small collections
List names = ["Alice", "Bob", "Charlie"];
bool exists = names.Contains("Alice");  // O(n) — acceptable if small

// For repeated lookups, use HashSet — O(1) lookup
HashSet nameSet = ["Alice", "Bob", "Charlie"];
bool exists = nameSet.Contains("Alice");  // O(1)

// For key-value lookup, Dictionary — O(1)
Dictionary customerMap = customers
    .ToDictionary(c => c.Id);
Customer? customer = customerMap.GetValueOrDefault(id);  // O(1)

// Wrong — O(n) lookup inside a loop → O(n²) total
foreach (OrderItem item in items)
{
    Product? product = products.FirstOrDefault(p => p.Id == item.ProductId);
}

// Right — build lookup once, use it in the loop → O(n)
Dictionary productMap = products.ToDictionary(p => p.Id);
foreach (OrderItem item in items)
{
    Product? product = productMap.GetValueOrDefault(item.ProductId);
}
```

**Rule**: If you call `FirstOrDefault`, `Contains`, or `Find` on a
`List` inside a loop, and the list has more than ~20 items,
convert it to a `HashSet` or `Dictionary` first.

#### LINQ Materialization
```csharp
// IEnumerable is lazy — multiple enumerations execute multiple times
IEnumerable orders = GetOrders();  // lazy
int count = orders.Count();    // iterates once
Order first = orders.First();  // iterates again
// If GetOrders() hits the database, this is two queries

// Materialize once when you need multiple operations on the result
IReadOnlyList orders = GetOrders().ToList();
int count = orders.Count;      // O(1) property
Order first = orders[0];       // O(1) index
```

Materialize (`ToList()`) when:
- You will iterate the collection more than once
- You need the count
- You need indexed access
- You are done querying and are processing results

Keep as `IEnumerable<T>` when:
- You are building a query and not yet executing it
- You are passing to another LINQ operator

* **Allocation Alert (Collection Expressions & IEnumerable):** Avoid passing C# collection expressions (e.g. `[1, 2, 3]`) directly to parameters of type `IEnumerable<T>` on high-throughput paths. This forces the compiler to allocate a compiler-generated iterator/wrapper. Use `ReadOnlySpan<T>` or explicit arrays (`T[]`) for non-persisted parameters to avoid unnecessary allocator pressure.
#### Avoid String Concatenation in Loops
```csharp
// Wrong — O(n²) allocations
string result = "";
foreach (string item in items)
{
    result += item + ", ";
}

// Right — O(n)
string result = string.Join(", ", items);

// When building complex strings in a loop
StringBuilder sb = new();
foreach (string item in items)
{
    sb.Append(item).Append(", ");
}
string result = sb.ToString();
```

---

### Async Performance

#### ValueTask for Hot Paths
```csharp
// Task allocates — for very hot paths, ValueTask avoids the allocation
// when the result is synchronously available (e.g. cache hit)
public async ValueTask GetOrderAsync(Guid id, CancellationToken ct)
{
    if (_cache.TryGetValue(id, out Order? cached))
        return cached;  // synchronous path — no Task allocation

    return await _db.Orders.FindAsync([id], ct);  // async path
}
```

Use `ValueTask` only on high-frequency paths where synchronous returns
are common. Use `Task` everywhere else — `ValueTask` has usage constraints.

#### Parallel Operations
```csharp
// Sequential — unnecessarily slow for independent operations
Customer customer = await GetCustomerAsync(customerId, ct);
IReadOnlyList orders = await GetOrdersAsync(customerId, ct);
decimal creditLimit = await GetCreditLimitAsync(customerId, ct);

// Parallel — all three run concurrently
(Customer customer, IReadOnlyList orders, decimal creditLimit) =
    await (
        GetCustomerAsync(customerId, ct),
        GetOrdersAsync(customerId, ct),
        GetCreditLimitAsync(customerId, ct))
    .WhenAll();

// Or with Task.WhenAll
Task customerTask = GetCustomerAsync(customerId, ct);
Task<IReadOnlyList> ordersTask = GetOrdersAsync(customerId, ct);
await Task.WhenAll(customerTask, ordersTask);
Customer customer = await customerTask;
IReadOnlyList orders = await ordersTask;
```

Only parallelize operations that are truly independent.
Never parallelize operations that share a DbContext —
DbContext is not thread-safe.

#### Parallel Bulk Processing
```csharp
// Processing a large collection with controlled parallelism
await Parallel.ForEachAsync(
    orderIds,
    new ParallelOptions
    {
        MaxDegreeOfParallelism = 8,
        CancellationToken = ct
    },
    async (orderId, innerCt) =>
    {
        // Each iteration gets its own scope and DbContext
        await using AsyncServiceScope scope =
            _scopeFactory.CreateAsyncScope();
        AppDbContext db =
            scope.ServiceProvider.GetRequiredService();
        await ProcessOrderAsync(db, orderId, innerCt);
    });
```

---

### Memory and Allocations

#### Span<T> for String/Buffer Operations
```csharp
// Wrong — allocates a new string for the substring
string prefix = input.Substring(0, 3);
bool isValid = prefix == "ORD";

// Right — no allocation, works on the original memory
ReadOnlySpan prefix = input.AsSpan(0, 3);
bool isValid = prefix.SequenceEqual("ORD");

// String splitting without allocation
ReadOnlySpan span = input.AsSpan();
foreach (Range segment in span.Split(','))
{
    ReadOnlySpan part = span[segment];
    // process part without allocating a string
}
```

#### ArrayPool for Temporary Buffers
```csharp
// Wrong — allocates a new array each time
byte[] buffer = new byte[4096];
int read = await stream.ReadAsync(buffer, ct);

// Right — rents from pool, returns after use
byte[] buffer = ArrayPool.Shared.Rent(4096);
try
{
    int read = await stream.ReadAsync(buffer.AsMemory(0, 4096), ct);
}
finally
{
    ArrayPool.Shared.Return(buffer);
}
```

Use `ArrayPool` for temporary buffers in hot paths.
Do not use it for buffers that outlive the method.

#### Avoid Closures in Loops
```csharp
// Wrong — captures loop variable by reference (classic C# trap)
List<Func> funcs = new();
for (int i = 0; i < 5; i++)
{
    funcs.Add(() => i);  // all funcs return 5 — captures i by ref
}

// Right — capture by value
for (int i = 0; i < 5; i++)
{
    int captured = i;
    funcs.Add(() => captured);
}
```

---

### MassTransit Performance

#### Batch Consumers for High-Throughput
```csharp
// Single message consumer — one DB round trip per message
public sealed class OrderCreatedConsumer : IConsumer
{
    public async Task Consume(ConsumeContext context) { ... }
}

// Batch consumer — one DB round trip for N messages
public sealed class OrderCreatedBatchConsumer
    : IConsumer<Batch>
{
    public async Task Consume(ConsumeContext<Batch> context)
    {
        Guid[] orderIds = context.Message
            .Select(m => m.Message.OrderId)
            .ToArray();

        // One query for all messages in the batch
        IReadOnlyList orders = await _db.Orders
            .Where(o => orderIds.Contains(o.Id))
            .ToListAsync(context.CancellationToken);
    }
}
```

Configure batch size:
```csharp
cfg.ReceiveEndpoint("order-created", e =>
{
    e.Batch(b =>
    {
        b.MessageLimit = 100;
        b.TimeLimit = TimeSpan.FromSeconds(1);
        b.Consumer(context);
    });
});
```

Use batch consumers for any high-volume message type where the
processing can be grouped.

---

### Frontend Performance

#### React — Avoid Unnecessary Re-renders
```ts
// A component re-renders when its parent re-renders OR its props change
// Only memoize when you have measured a problem — not by default

// Expensive list that re-renders often — memoize
const OrderList = React.memo(function OrderList({ orders }: OrderListProps) {
    return {orders.map(o => )}
})

// Stable callbacks — useCallback only when passed to memoized children
const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
}, [])  // empty deps — never changes
```

#### Virtualize Long Lists
Never render more than ~50-100 DOM items at once.
For lists longer than this, use the virtualization library in the project
(check CONTEXT.md) — do not render all items and hide them with CSS.

#### Debounce User Input
```ts
// Search input — do not fire API request on every keystroke
const debouncedSearch = useDebouncedValue(searchTerm, 300)

useQuery({
    queryKey: queryKeys.products.search(debouncedSearch),
    queryFn: () => api.searchProducts(debouncedSearch),
    enabled: debouncedSearch.length >= 2,
})
```

#### Bundle Size
- Check bundle size before adding a new library:
  use `bundlephobia.com` or `pnpm why [package]`
- Import only what you use — named imports, not default objects:
```ts
  // Wrong — imports entire lodash
  import _ from 'lodash'
  _.debounce(fn, 300)
  
  // Right — imports only debounce
  import debounce from 'lodash/debounce'
```
- Date libraries (date-fns, luxon) are large — confirm one already
  exists before adding

---

### Caching Strategy
See `garnet-caching.md` for the full caching implementation.
Performance rules specific to caching:

- Cache at the service boundary, not inside loops
- Never cache inside a loop — cache before the loop and look up:
```csharp
  // Wrong — cache check per iteration
  foreach (Guid id in ids)
  {
      Order? order = await _cache.GetAsync(id, ct)
          ?? await _db.Orders.FindAsync(id, ct);
  }
  
  // Right — batch load uncached items
  Dictionary cached = await GetCachedOrdersAsync(ids, ct);
  IReadOnlyList missing = ids
      .Where(id => !cached.ContainsKey(id))
      .ToList();
  IReadOnlyList fromDb = await _db.Orders
      .Where(o => missing.Contains(o.Id))
      .AsNoTracking()
      .ToListAsync(ct);
```

---

### What to Always Check

Before any code review or completing a task, scan for these:

1. `await` inside `foreach` over a database-loaded collection → N+1
2. `.ToList()` or `.ToListAsync()` before `.Where()` → filtering in memory
3. `.Count()` on a materialized list → should be `.Count` property or `CountAsync`
4. `FirstOrDefault` / `Contains` on a `List` inside a loop → use `Dictionary`/`HashSet`
5. `string +=` inside a loop → use `StringBuilder` or `string.Join`
6. `Skip(n * pageSize).Take(pageSize)` on large tables → keyset pagination
7. Loading an entity just to read one property → project with `Select`
8. `Task` inside `Parallel.ForEach` → use `Parallel.ForEachAsync`
9. Multiple independent `await` calls sequentially → `Task.WhenAll`
10. Rendering unbounded lists in React → virtualization