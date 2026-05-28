## Timezone Handling — Global Scale Rules

These rules are non-negotiable. Timezone mistakes corrupt data silently
and are extremely difficult to recover from in production.

---

### The Foundational Rules

1. **The database stores UTC. Always. No exceptions.**
2. **The server never assumes its own timezone.**
3. **`DateTime` does not exist in this codebase — use `DateTimeOffset`.**
4. **Conversion to user's local timezone happens at the display boundary only.**
5. **Timezone IDs are always IANA format — never Windows format.**

---

### C# — Types

#### DateTimeOffset, not DateTime
`DateTime` is banned from this codebase for anything that represents
a moment in time. It has no timezone information and is a source of
silent corruption.

```csharp
// Wrong — always
DateTime now = DateTime.Now;
DateTime utcNow = DateTime.UtcNow;
DateTime createdAt = order.CreatedAt;

// Right — always
DateTimeOffset now = DateTimeOffset.UtcNow;
DateTimeOffset createdAt = order.CreatedAt;
```

The only acceptable use of `DateTime` is as an intermediate value
when interacting with a third-party library that forces it —
immediately convert back to `DateTimeOffset`.

#### Getting Current Time
```csharp
// Wrong
DateTime.Now          // local server time — meaningless on a server
DateTime.UtcNow       // loses timezone context

// Right
DateTimeOffset.UtcNow  // always, on the server

// Even better for testability — inject IClock or TimeProvider
// and use it instead of static calls:
public sealed class OrderHandler
{
    private readonly TimeProvider _timeProvider;

    public OrderHandler(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider;
    }

    public async Task HandleAsync(CreateOrderCommand command, CancellationToken ct)
    {
        DateTimeOffset now = _timeProvider.GetUtcNow();
        // ...
    }
}

// Registration
builder.Services.AddSingleton(TimeProvider.System);
// In tests: use FakeTimeProvider from Microsoft.Extensions.TimeProvider.Testing
```

#### DateOnly and TimeOnly
- `DateOnly` for calendar dates that have no time component:
  birthdays, holidays, business dates, expiration dates
- `TimeOnly` for times without a date: business hours, scheduled times
- When you see `DateTime` used for a date-only concept (midnight UTC trick),
  replace it with `DateOnly`
- `DateOnly` does NOT have timezone concerns — it represents a calendar date
  as humans understand it (June 15th is June 15th regardless of timezone)

```csharp
// A subscription expiry — it is a date, not a moment
public sealed record Subscription(
    Guid Id,
    DateOnly ExpiresOn,         // June 15, 2027 — no time, no timezone
    DateTimeOffset CreatedAt);  // The exact moment it was created — UTC

// Check expiry against today in the user's timezone
public bool IsExpired(DateOnly today) => ExpiresOn < today;
```

---

### C# — Timezone Conversion

#### TimeZoneInfo with IANA IDs
```csharp
// Convert UTC to user's local time for display or business logic
// Always use IANA timezone IDs — not Windows IDs
// Wrong: "Eastern Standard Time" (Windows)
// Right: "America/New_York" (IANA)

TimeZoneInfo userZone = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
DateTimeOffset userLocalTime = TimeZoneInfo.ConvertTime(
    DateTimeOffset.UtcNow,
    userZone);
```

On .NET 10, IANA timezone IDs work cross-platform natively.
Do not use `RuntimeInformation` checks for timezone ID format.
Do not use `TimeZoneConverter` NuGet package unless it already exists
in the project — .NET 10 does not need it.

#### Storing User Timezone
Store the user's IANA timezone ID as a `string` — not an offset:
```csharp
public sealed class UserPreferences
{
    public string TimeZoneId { get; private set; }  // "Europe/Istanbul"
    // NOT: int UtcOffsetMinutes — offsets change with DST
    // NOT: TimeSpan UtcOffset — same problem
}
```

An offset (`+03:00`) is a snapshot — it will be wrong during DST transitions.
An IANA ID (`Europe/Istanbul`) is authoritative — it knows about DST.

#### Getting Today in a User's Timezone
```csharp
public DateOnly GetTodayInUserTimezone(string ianaTimezoneId)
{
    TimeZoneInfo zone = TimeZoneInfo.FindSystemTimeZoneById(ianaTimezoneId);
    DateTimeOffset userNow = TimeZoneInfo.ConvertTime(
        _timeProvider.GetUtcNow(),
        zone);
    return DateOnly.FromDateTime(userNow.DateTime);
}
```

Never use `DateOnly.FromDateTime(DateTime.Today)` — `DateTime.Today`
is the server's local date, which is meaningless.

#### DST-Safe Date Arithmetic
When adding days/months/years to a local time, DST can cause
the result to land in a gap or ambiguous time:
```csharp
// Wrong — naive arithmetic ignores DST
DateTimeOffset nextMonth = userLocalTime.AddDays(30);

// Right — do arithmetic in the timezone, then convert back
TimeZoneInfo zone = TimeZoneInfo.FindSystemTimeZoneById(userTimezoneId);
DateTimeOffset userLocal = TimeZoneInfo.ConvertTime(utcTime, zone);

// Add in local time context
DateTimeOffset nextMonthLocal = new DateTimeOffset(
    userLocal.DateTime.AddDays(30),
    zone.GetUtcOffset(userLocal.DateTime.AddDays(30)));
```

For complex recurring schedules or anything DST-sensitive,
check if NodaTime is already in the project — use it if so.
Do not add NodaTime without checking first.

---

### PostgreSQL + EF Core

#### Always Use timestamptz
`timestamp` (without timezone) in PostgreSQL stores local time with
no timezone information. It is banned.
`timestamptz` stores UTC and is timezone-aware. Always use this.

With Npgsql (EF Core PostgreSQL provider), `DateTimeOffset` maps
to `timestamptz` automatically. Confirm this is configured:
```csharp
// In DbContext OnConfiguring or AppContext:
// Npgsql maps DateTimeOffset → timestamptz by default
// Do NOT use DateTime for entity properties — it maps to timestamp (no tz)
```

Entity properties:
```csharp
// Wrong
public DateTime CreatedAt { get; set; }      // maps to timestamp — no tz

// Right
public DateTimeOffset CreatedAt { get; set; } // maps to timestamptz — UTC
```

EF Core configuration — be explicit:
```csharp
builder.Property(o => o.CreatedAt)
    .HasColumnType("timestamptz")
    .IsRequired();
```

For `DateOnly` with Npgsql:
```csharp
// DateOnly maps to PostgreSQL date type — correct for date-only values
builder.Property(s => s.ExpiresOn)
    .HasColumnType("date")
    .IsRequired();
```

#### Never Store an Offset Without a Timezone ID
If you need to display time in the user's original timezone later,
storing just the offset is not enough — the offset changes with DST.
Store the IANA timezone ID alongside when needed:
```csharp
public sealed class ScheduledEvent
{
    public DateTimeOffset OccursAt { get; private set; }  // UTC — the source of truth
    public string OrganizerTimeZoneId { get; private set; } // For display only
    // When displaying to the organizer: convert OccursAt to OrganizerTimeZoneId
}
```

---

### MassTransit — Message Contracts
All datetime fields in contracts use `DateTimeOffset`:
```csharp
// Wrong
public sealed record OrderCreated(
    Guid OrderId,
    DateTime CreatedAt);  // which timezone? unknown

// Right
public sealed record OrderCreated(
    Guid OrderId,
    DateTimeOffset CreatedAt);  // always UTC from the publisher
```

Consumers must not assume the offset of an incoming `DateTimeOffset` —
always normalize to UTC first if doing comparisons:
```csharp
DateTimeOffset normalizedUtc = message.CreatedAt.ToUniversalTime();
```

---

### API Layer — Serialization

ISO 8601 with UTC offset is the wire format for all datetimes:
2026-05-28T14:30:00Z          ← UTC (preferred for server timestamps)
2026-05-28T17:30:00+03:00     ← with explicit offset (acceptable)

Never serialize a bare date like `2026-05-28 14:30:00` — no offset,
no timezone, not parseable unambiguously.

System.Text.Json configuration:
```csharp
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(
        new JsonStringEnumConverter());
    // DateTimeOffset serializes as ISO 8601 with offset by default
    // Do not override this behavior
});
```

For `DateOnly` serialization, confirm the project has a converter registered —
`DateOnly` does not serialize automatically in all versions:
```csharp
// If not already registered
options.SerializerOptions.Converters.Add(
    new DateOnlyJsonConverter()); // reads/writes "2026-05-28"
```

---

### TypeScript / Frontend

#### Never Construct Dates from Bare Strings
```ts
// Wrong — behavior is timezone-dependent and browser-inconsistent
new Date('2026-05-28')           // parsed as UTC midnight in some browsers,
                                  // local midnight in others
new Date('2026-05-28 14:30:00')  // not ISO 8601 — undefined behavior

// Right — API always returns ISO 8601 with offset
new Date('2026-05-28T14:30:00Z')        // explicit UTC — safe
new Date('2026-05-28T17:30:00+03:00')   // explicit offset — safe
```

#### Display in User's Timezone
Use `Intl.DateTimeFormat` — it uses the browser's detected timezone by default:
```ts
// Display using user's browser timezone automatically
const formatter = new Intl.DateTimeFormat('default', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: userTimezoneId ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
})

formatter.format(new Date(isoStringFromApi))
```

Never display a raw UTC ISO string to a user.
Never call `.toISOString()` for display — it always outputs UTC.

#### Getting User's Timezone
```ts
// Get the user's browser timezone (IANA ID)
const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
// "Europe/Istanbul", "America/New_York", etc.

// Send this to the backend when the user sets preferences
// Store it in the user profile
// Use it when calling APIs that need a timezone context
```

#### Date-Only Values
When the API returns a `DateOnly` value (e.g. `"2026-05-28"`):
- Do NOT construct `new Date('2026-05-28')` — it parses as UTC midnight
  and `.toLocaleDateString()` may show the previous day in negative offset timezones
- Parse manually or use a library function that handles date-only strings:
```ts
  // Safe date-only parsing
  function parseDateOnly(dateString: string): { year: number; month: number; day: number } {
    const [year, month, day] = dateString.split('-').map(Number)
    return { year, month: month - 1, day }  // month is 0-indexed for Date
  }

  // Display a date-only value
  function formatDateOnly(dateString: string, locale = 'default'): string {
    const { year, month, day } = parseDateOnly(dateString)
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',  // no conversion — it is already a calendar date
    }).format(new Date(Date.UTC(year, month, day)))
  }
```

#### Sending Datetimes to the API
Always send UTC ISO 8601 from the client:
```ts
// User selects a time in their local timezone — convert to UTC before sending
const localDate = new Date(userSelectedValue)
const utcIsoString = localDate.toISOString()  // always UTC with Z suffix

await api.createEvent({ scheduledAt: utcIsoString })
```

---

### What to Always Verify

After any code that touches dates or times:

**Backend**
1. Is `DateTime` used anywhere? Replace with `DateTimeOffset`
2. Is `.Now` called without `DateTimeOffset`? Replace with `_timeProvider.GetUtcNow()`
3. Are EF Core entity datetime properties `DateTimeOffset` (not `DateTime`)?
4. Are PostgreSQL columns `timestamptz` (not `timestamp`)?
5. Is user timezone stored as IANA string (not offset, not Windows ID)?
6. Are MassTransit message contracts using `DateTimeOffset`?
7. Is DST-sensitive date arithmetic using timezone-aware methods?

**Frontend**
1. Are date strings constructed only from valid ISO 8601 with offset?
2. Are dates displayed using `Intl.DateTimeFormat` with explicit timezone?
3. Are date-only values parsed without `new Date(dateOnlyString)`?
4. Are datetime values sent to the API as UTC ISO 8601?

**Never acceptable**
- `DateTime` for moments in time
- `timestamp` (no tz) in PostgreSQL
- Windows timezone IDs as stored values
- Offset-only storage without IANA ID where DST matters
- `Date` constructed from a date-only string without UTC anchoring
- Displaying `.toISOString()` to users
- Server-side `.ToLocalTime()` calls