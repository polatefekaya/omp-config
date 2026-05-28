## .NET 10 Patterns — Read Before Assuming

### Critical: Do not assume which pattern this service uses
Some services use Mediator.SourceGenerators. Some do not.
Before writing a handler or command:
1. Check CONTEXT.md under "Mediator Pattern" — it will say which this service uses
2. If CONTEXT.md is unclear, grep for `ICommand`, `IQuery`, `ICommandHandler`, `IQueryHandler`
   and `using Mediator` to detect if Mediator.SourceGenerators is present
3. If it is NOT present, handlers are plain classes called directly — no mediator dispatch

### Vertical Slice Feature Folders
Features live entirely in one folder. Do not reach outside it.
Typical shape (read the existing features in this service — they are the actual convention):
Features/
  [FeatureName]/
    [FeatureName]Command.cs
    [FeatureName]Handler.cs       ← ICommandHandler<TCommand> if using Mediator
    [FeatureName]Validator.cs
    [FeatureName]Endpoint.cs
    [FeatureName]Response.cs

### Domain Events → MassTransit
Domain events eventually flow into MassTransit — but the mechanism varies per service.
Before adding a domain event dispatch, read how existing events are published in this service.
Do not introduce a new dispatch mechanism. Find the existing one and use it.

### General
- `record` for commands, queries, DTOs, domain events
- `sealed` on everything not designed for inheritance
- Nullable reference types on — every nullable warning is an error
- No `dynamic`, no `object` without justification
- No new NuGet packages without checking what's already in the project
- Handlers call DbContext directly — do not introduce a repository layer
  unless one already exists in this service