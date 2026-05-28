## EF Core + PostgreSQL

---

### DbContext Rules

#### Lifetime
- DbContext is scoped — registered as `AddDbContext<T>` (scoped by default)
- Never inject DbContext into a singleton — use `IServiceScopeFactory`
- Never share a DbContext instance across threads
- In background services: create a new scope per unit of work (see background-services.md)

#### Configuration
```csharp
builder.Services.AddDbContext((sp, options) =>
{
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("Default"),
        npgsql =>
        {
            npgsql.EnableRetryOnFailure(
                maxRetryCount: 3,
                maxRetryDelay: TimeSpan.FromSeconds(5),
                errorCodesToAdd: null);
            npgsql.UseQuerySplittingBehavior(
                QuerySplittingBehavior.SplitQuery);
        })
        .UseSnakeCaseNamingConvention()
        .EnableSensitiveDataLogging(
            builder.Environment.IsDevelopment());
});
```

`UseSnakeCaseNamingConvention()` is mandatory — all columns and tables
are snake_case in PostgreSQL. Never add manual `HasColumnName` unless
overriding the convention for a specific reason.

`UseQuerySplittingBehavior(SplitQuery)` is set globally — collection
includes generate separate queries instead of cartesian products.
Override per-query with `.AsSingleQuery()` only when you have measured
that a single query is faster.

#### AppDbContext Shape
```csharp
public sealed class AppDbContext(DbContextOptions options)
    : DbContext(options)
{
    public DbSet Orders => Set();
    public DbSet Products => Set();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(
            Assembly.GetExecutingAssembly());
        // All entity configurations are in separate IEntityTypeConfiguration classes
    }
}
```

Never configure entities inline in `OnModelCreating` —
use `IEntityTypeConfiguration<T>` per entity in the same feature folder.

---

### Entity Configuration

#### IEntityTypeConfiguration
```csharp
// Features/Orders/OrderConfiguration.cs
public sealed class OrderConfiguration : IEntityTypeConfiguration
{
    public void Configure(EntityTypeBuilder builder)
    {
        builder.ToTable("orders");

        builder.HasKey(o => o.Id);

        builder.Property(o => o.Id)
            .HasColumnType("uuid")
            .ValueGeneratedNever();  // application generates IDs — not the DB

        builder.Property(o => o.Status)
            .HasConversion()  // store enum as string
            .HasMaxLength(50)
            .IsRequired();

        builder.Property(o => o.CreatedAt)
            .HasColumnType("timestamptz")
            .IsRequired();

        builder.Property(o => o.Total)
            .HasColumnType("numeric(18,4)")
            .IsRequired();

        // Optimistic concurrency via PostgreSQL xmin system column
        builder.UseXminAsConcurrencyToken();

        // Indexes
        builder.HasIndex(o => o.CustomerId);
        builder.HasIndex(o => new { o.Status, o.CreatedAt });
        builder.HasIndex(o => o.CreatedAt)
            .IsDescending()
            .HasFilter("status = 'pending'");  // partial index
    }
}
```

#### Value Objects as Owned Entities
```csharp
// Value object
public sealed record Address(
    string Street,
    string City,
    string Country,
    string PostalCode);

// Configuration
builder.OwnsOne(o => o.ShippingAddress, address =>
{
    address.Property(a => a.Street)
        .HasMaxLength(200)
        .IsRequired();
    address.Property(a => a.City)
        .HasMaxLength(100)
        .IsRequired();
    address.Property(a => a.Country)
        .HasMaxLength(2)  // ISO 3166-1 alpha-2
        .IsRequired();
    address.Property(a => a.PostalCode)
        .HasMaxLength(20)
        .IsRequired();
});

// Complex value objects that do not need querying — use JSONB
builder.OwnsOne(o => o.Metadata, metadata =>
{
    metadata.ToJson();  // stored as jsonb column
});
```

#### PostgreSQL Enums
Register and use PostgreSQL native enums for type safety and performance:
```csharp
// In DbContext or extension method
modelBuilder.HasPostgresEnum();

// Entity configuration
builder.Property(o => o.Status)
    .HasColumnType("order_status");  // matches the registered enum name

// Registration in DI (Npgsql needs to know about it)
builder.Services.AddDbContext(options =>
    options.UseNpgsql(connectionString,
        npgsql => npgsql.MapEnum()));
```

Only use PostgreSQL enums if they are already used in the project.
Do not introduce them for new fields — check with the team first,
as adding values requires a migration and database-level change.

#### PostgreSQL Arrays
```csharp
// Entity property
public string[] Tags { get; private set; } = [];

// Configuration
builder.Property(p => p.Tags)
    .HasColumnType("text[]");

// Querying
IReadOnlyList tagged = await _db.Products
    .Where(p => p.Tags.Contains("featured"))
    .ToListAsync(ct);
```

#### JSONB for Flexible Data
```csharp
// Owned type stored as JSONB
builder.OwnsOne(e => e.ExtendedProperties, props =>
{
    props.ToJson();  // EF Core 7+ — maps to jsonb
});

// Raw JSONB when the schema is truly dynamic
builder.Property(e => e.RawMetadata)
    .HasColumnType("jsonb");
```

---

### Query Patterns

#### AsNoTracking on All Read Queries
```csharp
// Every query that does not modify data uses AsNoTracking
Order? order = await _db.Orders
    .AsNoTracking()
    .Include(o => o.Items)
    .FirstOrDefaultAsync(o => o.Id == id, ct);

// Or set globally for read-only DbContext registrations
options.UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking);
```

#### Project to DTOs — Do Not Load Full Entities for Read Operations
```csharp
// Wrong — loads entire entity including all columns and navigation props
IReadOnlyList orders = await _db.Orders
    .Where(o => o.CustomerId == customerId)
    .ToListAsync(ct);

// Right — project to exactly what is needed
IReadOnlyList summaries = await _db.Orders
    .Where(o => o.CustomerId == customerId)
    .Select(o => new OrderSummary(
        o.Id,
        o.Total,
        o.Status,
        o.CreatedAt))
    .AsNoTracking()
    .ToListAsync(ct);
```

#### Explicit Includes — No Lazy Loading
Lazy loading is disabled. All related data must be explicitly included.
Before writing a query, decide exactly what data is needed.
```csharp
// Only include what the operation actually uses
Order? order = await _db.Orders
    .Include(o => o.Items)
        .ThenInclude(i => i.Product)
    .AsNoTracking()
    .FirstOrDefaultAsync(o => o.Id == id, ct);
```

Never use `.Include()` as a blanket safety net —
include only what the calling code actually accesses.

---

### Migrations

#### Creating Migrations
```bash
dotnet ef migrations add [DescriptiveName] \
  --project [InfrastructureProject] \
  --startup-project [ApiProject] \
  --output-dir Migrations
```

Migration names must be descriptive — not `Update1` or `Fix`:
AddOrderStatusIndex
AddCustomerEmailUniqueConstraint
RenameProductSkuToProductCode
AddOrderItemsTable

#### After Creating a Migration — Always Read It
Before committing a migration, read the generated file and confirm:
- No unexpected `DROP TABLE` or `DROP COLUMN`
- No data loss operations without a corresponding data migration
- Column types match what was configured (`timestamptz`, `numeric`, `uuid`, etc.)
- Indexes are created with the right columns and conditions
- If anything looks wrong: delete the migration, fix the configuration, regenerate

#### Never Run Migrations Manually
Migrations run automatically on startup via:
```csharp
// In Program.cs or a startup extension
await using AsyncServiceScope scope = app.Services.CreateAsyncScope();
AppDbContext db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
await db.Database.MigrateAsync();
```

Never run `dotnet ef database update` in production.
Never run it locally against a shared dev database.

#### Dangerous Migration Patterns — Stop and Verify
If a migration contains any of these, stop and verify intent before proceeding:
- `DropTable` — is this intentional? Is data being migrated first?
- `DropColumn` — is the column still used in code anywhere? Grep first.
- `AlterColumn` that changes type — PostgreSQL may require explicit CAST
- `RenameColumn` — EF Core generates this correctly but confirm the old name is gone from all queries

---

### Bulk Operations

Use `ExecuteUpdateAsync` and `ExecuteDeleteAsync` for bulk changes
instead of loading entities into memory:

```csharp
// Wrong — loads all entities, tracks them, generates N UPDATE statements
IReadOnlyList<Order> expiredOrders = await _db.Orders
    .Where(o => o.Status == OrderStatus.Pending
        && o.CreatedAt < cutoff)
    .ToListAsync(ct);

foreach (Order order in expiredOrders)
{
    order.Cancel();
}
await _db.SaveChangesAsync(ct);

// Right — single UPDATE statement, no entity loading
int affected = await _db.Orders
    .Where(o => o.Status == OrderStatus.Pending
        && o.CreatedAt < cutoff)
    .ExecuteUpdateAsync(
        s => s.SetProperty(o => o.Status, OrderStatus.Cancelled)
               .SetProperty(o => o.UpdatedAt, DateTimeOffset.UtcNow),
        ct);
```

`ExecuteUpdateAsync` and `ExecuteDeleteAsync` bypass change tracking
and interceptors — confirm this is acceptable before using them.
They also do not trigger domain events. If domain events are needed,
load the entities and go through the normal path.

---

### Concurrency

#### Optimistic Concurrency with xmin
PostgreSQL's `xmin` system column changes on every row update —
perfect for optimistic concurrency without an extra column:

```csharp
// Configuration
builder.UseXminAsConcurrencyToken();

// Handling conflicts
try
{
    await _db.SaveChangesAsync(ct);
}
catch (DbUpdateConcurrencyException ex)
{
    // Another process modified this row between our read and write
    // Options: retry with fresh data, or surface a conflict error
    _logger.LogWarning(
        "Concurrency conflict on {EntityType} {EntityId}",
        ex.Entries[0].Entity.GetType().Name,
        ex.Entries[0].Property("Id").CurrentValue);
    throw new ConflictException("The record was modified by another process.");
}
```

---

### Indexes

#### Rules for Adding Indexes
- Every foreign key column gets an index
- Every column used in a `WHERE` clause in frequent queries gets an index
- Composite indexes: order columns by selectivity (most selective first)
  and match the query's filter + sort pattern
- Partial indexes for filtered queries (e.g. only active records):
```csharp
  builder.HasIndex(o => o.CreatedAt)
      .HasFilter("status = 'active'");
```
- Covering indexes for read-heavy queries that project specific columns:
```csharp
  builder.HasIndex(o => o.CustomerId)
      .IncludeProperties(o => new { o.Status, o.Total, o.CreatedAt });
```

#### What NOT to Index
- Columns with very low cardinality (boolean, small enum) as standalone indexes
- Columns never used in WHERE, JOIN, or ORDER BY
- Every column blindly — indexes slow down writes

---

### Transactions

```csharp
// Explicit transaction for multi-step operations
await using IDbContextTransaction tx =
    await _db.Database.BeginTransactionAsync(ct);
try
{
    _db.Orders.Add(order);
    await _db.SaveChangesAsync(ct);

    await _bus.Publish(new OrderCreated(order.Id), ct);  // outbox handles this

    await tx.CommitAsync(ct);
}
catch
{
    await tx.RollbackAsync(ct);
    throw;
}
```

MassTransit outbox: publish inside the same DbContext transaction —
do not publish after the transaction commits. The outbox guarantees
delivery after the transaction succeeds.

---

### Connection Pooling (Npgsql)

Npgsql has its own connection pool independent of .NET's.
Default pool size is fine for most services — do not change it
without measuring. If connection exhaustion is observed in SigNoz,
investigate query duration before increasing pool size.

```csharp
// Connection string pool settings — only set if measured
"Host=localhost;Database=mydb;Username=user;Password=pass;
 Maximum Pool Size=100;Minimum Pool Size=5;
 Connection Idle Lifetime=300"
```

---

### What to Verify After EF Core Changes

1. Are all read queries using `AsNoTracking()`?
2. Are read queries projecting to DTOs, not loading full entities?
3. Do new entity properties use correct PostgreSQL types
   (`timestamptz`, `uuid`, `numeric`, `text[]`, `jsonb`)?
4. Is every new foreign key column indexed?
5. Was the generated migration read and verified before committing?
6. Does the migration contain any unexpected destructive operations?
7. Are bulk operations using `ExecuteUpdateAsync`/`ExecuteDeleteAsync`?
8. Are explicit includes present for every navigation property accessed?