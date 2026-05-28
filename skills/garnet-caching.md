## Caching — Microsoft Garnet

Garnet is the cache server in this stack — wire-compatible with Redis.
StackExchange.Redis is the client library.

### When to cache
Cache when:
- The data is expensive to compute or fetch (DB query, external API call)
- The data changes infrequently relative to how often it is read
- Stale data for a short TTL is acceptable

Do NOT cache when:
- The data must always be fresh (user-specific sensitive state, payment info)
- You are trying to work around a slow query — fix the query first
- The cached value would need to be invalidated so frequently that the cache
  provides no benefit

### Cache-Aside Pattern (standard)
```csharp
public async Task<Order?> GetOrderAsync(string orderId, CancellationToken ct)
{
    var cacheKey = CacheKeys.Order(orderId);
    
    // 1. Try cache
    var cached = await _cache.GetStringAsync(cacheKey, ct);
    if (cached is not null)
        return JsonSerializer.Deserialize<Order>(cached);
    
    // 2. Read from source
    var order = await _db.Orders
        .AsNoTracking()
        .FirstOrDefaultAsync(o => o.Id == orderId, ct);
    
    if (order is null) return null;
    
    // 3. Populate cache
    await _cache.SetStringAsync(
        cacheKey,
        JsonSerializer.Serialize(order),
        new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = CacheTtl.Order
        },
        ct);
    
    return order;
}
```

### Cache Key Conventions
- Keys live in a static `CacheKeys` class — never inline strings
- Format: `{service}:{entity}:{identifier}` using colons as separators
- All lowercase, no spaces:
```csharp
  public static class CacheKeys
  {
      public static string Order(string id) => $"orders:order:{id}";
      public static string UserOrders(string userId) => $"orders:user-orders:{userId}";
      public static string ProductCatalog() => "catalog:product-catalog:all";
  }
```
- Read the existing `CacheKeys` class before adding new keys — it likely exists

### TTL Conventions
- TTLs live in a static `CacheTtl` class — never magic numbers inline:
```csharp
  public static class CacheTtl
  {
      public static readonly TimeSpan Order = TimeSpan.FromMinutes(5);
      public static readonly TimeSpan UserOrders = TimeSpan.FromMinutes(2);
      public static readonly TimeSpan ProductCatalog = TimeSpan.FromHours(1);
  }
```
- Short TTL (seconds–2 min): frequently changing data where brief staleness is acceptable
- Medium TTL (2–15 min): business entities that change occasionally
- Long TTL (hours): reference data, catalogs, configuration
- When in doubt: shorter TTL — cache stampede is worse than cache miss

### Cache Invalidation
- Invalidate explicitly on write — do not rely solely on TTL expiration:
```csharp
  await _db.SaveChangesAsync(ct);
  await _cache.RemoveAsync(CacheKeys.Order(order.Id), ct);
```
- If multiple keys must be invalidated together, list them explicitly —
  do not use key scanning (KEYS pattern) in production
- When a MassTransit consumer processes an event that changes data:
  invalidate the relevant cache keys in the consumer after processing

### Serialization
- `System.Text.Json` only — `JsonSerializer.Serialize` / `JsonSerializer.Deserialize`
- Use the same `JsonSerializerOptions` configured at app startup — read DI setup
  for the registered options, do not create new options instances per call
- Nullable deserialization: treat null from cache as cache miss, not as a valid null value

### Cache Stampede Prevention
When multiple concurrent requests miss the cache simultaneously:
- Use `SemaphoreSlim` per key for hot paths, or
- Use the existing stampede prevention pattern if one exists in the project
- Read the existing cache helper/service before writing new caching logic

### Observability
- Add a span for cache operations — tag with:
  - `cache.hit` bool tag
  - `cache.key` (the key pattern, not the full key if it contains IDs)
- Log at Debug level for cache misses on hot paths — not Information
- Do not log cache values — they may contain sensitive data

### Garnet-specific notes
- Garnet is wire-compatible with Redis — all StackExchange.Redis operations work
- Connection string format: `localhost:3278` (default Garnet port) or as configured
- Read CONTEXT.md for the actual connection configuration in this service
- Garnet supports persistence — do not assume data is lost on restart
  unless the deployment is configured without persistence
- If the project uses `IDistributedCache` abstraction: use that, not
  `IConnectionMultiplexer` directly, unless you need Lua scripts or pub/sub