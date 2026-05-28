## Self-Verification Protocol

You cannot run `dotnet build` on services that depend on the private NuGet feed.
This does not mean skipping verification — it means verifying differently.

### After every backend change
1. Re-read every file you modified from disk — confirm your changes are actually there
2. For every type you referenced: confirm it exists by reading its source file
3. For every MassTransit consumer: read the DI registration and confirm it is wired
4. For every contracts type you used: read it from the contracts source (path in CONTEXT.md)
5. For every Activity you added: confirm the ActivitySource matches the one registered in DI
6. Check for nullable warnings by reading your own code critically —
   every variable that could be null must be handled
7. If you added EF Core entity changes: read the DbContext configuration
   and confirm the mapping is complete

### After every frontend change
1. Mentally trace the TypeScript types — if you are unsure, read the type definition
2. If you changed a query key: grep for all usages and confirm consistency
3. If you used a Tailwind class: confirm it is valid v4 syntax
4. `tsc --noEmit` — run this, fix any errors before responding

### The bar
Do not say "this should work."
Do not say "you may need to adjust X."
Either it is correct and you have verified it, or you say specifically what you could not verify and why.