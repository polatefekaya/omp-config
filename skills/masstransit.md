## MassTransit 8.5.5

### Consumer rules
- Implement `IConsumer<TMessage>` — method signature: `Task Consume(ConsumeContext<T> context)`
- Read the message type from the contracts source before writing the consumer body
- After writing a consumer, read the MassTransit registration (look for `AddMassTransit` in DI setup)
  and confirm this consumer is registered — if not, add it
- Outbox is via EF Core outbox — do not call `IBus.Publish` directly for transactional messages,
  use the outbox-aware publish on the ConsumeContext or the outbox interface

### Sagas
- Inherit `MassTransitStateMachine<TState>` where TState implements `SagaStateMachineInstance`
- State is persisted — read the existing saga repository registration before adding a new saga
- Every state transition needs error handling — read existing sagas for the pattern

### Request/Response
- Use `IRequestClient<TRequest>` injected via DI — not `IBus.Request`
- The response type comes from the contracts library — read it before writing the handler

### What to always verify after MassTransit changes
- Is the consumer/saga registered in AddMassTransit?
- Does the message type match exactly what's in the contracts source?
- If using outbox: is this operation inside a transaction scope?