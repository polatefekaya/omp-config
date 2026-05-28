## SolidJS Conventions

Read frontend.md first. This covers Solid-specific patterns.
Solid is NOT React. Do not apply React patterns here.

---

### The Fundamental Difference
In React, components re-run on every state change.
In Solid, components run ONCE. Reactivity is in the signals, not the component.

This changes everything.

---

### Signals
```ts
const [count, setCount] = createSignal(0)
const [user, setUser] = createSignal<User | null>(null)

// Read a signal by calling it
count()        // 0
user()?.name   // undefined

// Write a signal
setCount(1)
setCount(prev => prev + 1)  // functional update
setUser({ id: '1', name: 'Alice' })
```

---

### The Most Common Mistake — Destructuring
NEVER destructure signals, props, or store values outside of JSX or effects.
Destructuring breaks reactivity tracking.

```ts
// WRONG — count is now a frozen number, not reactive
const value = count()
return <div>{value}</div>

// RIGHT — count() is called inside JSX, tracked by Solid
return <div>{count()}</div>

// WRONG — name is a frozen string
const { name } = props
return <span>{name}</span>

// RIGHT
return <span>{props.name}</span>
```

---

### Props
- Always access as `props.x` — never destructure
- Use `splitProps` when you need to forward some props:
```ts
  const [local, others] = splitProps(props, ['class', 'onClick'])
  return <button class={local.class} onClick={local.onClick} {...others} />
```
- Use `mergeProps` for default values:
```ts
  const merged = mergeProps({ size: 'md', variant: 'primary' }, props)
```

---

### Derived State
```ts
// createMemo for derived values — runs only when deps change
const total = createMemo(() =>
  items().reduce((sum, item) => sum + item.price * item.quantity, 0)
)

// Access like a signal
total()
```

---

### Effects
```ts
// createEffect runs when any signal accessed inside it changes
createEffect(() => {
  console.log('count changed:', count())
  // Solid auto-tracks count() as a dependency
})

// Cleanup
createEffect(() => {
  const id = setInterval(() => tick(), 1000)
  onCleanup(() => clearInterval(id))
})

// onMount — runs once after component mounts
onMount(() => {
  focusRef.focus()
})
```

---

### Control Flow — Use Solid's Components
Do not use JavaScript control flow in JSX — use Solid's flow components.

```tsx
// Conditional
<Show when={isLoggedIn()} fallback={<LoginButton />}>
  <UserMenu />
</Show>

// List rendering
<For each={items()}>
  {(item, index) => <ItemCard item={item} index={index()} />}
</For>

// Switch/Match
<Switch fallback={<NotFound />}>
  <Match when={status() === 'loading'}><Spinner /></Match>
  <Match when={status() === 'error'}><ErrorMessage /></Match>
  <Match when={status() === 'success'}><Content data={data()} /></Match>
</Switch>

// Render once
<Dynamic component={components[type()]} {...props} />
```

---

### Stores (Complex State)
```ts
import { createStore, produce } from 'solid-js/store'

const [state, setState] = createStore({
  items: [] as CartItem[],
  isOpen: false,
})

// Update with produce (immer-like)
setState(produce((s) => {
  s.items.push(newItem)
  s.isOpen = true
}))

// Path-based update (fine-grained, preferred for performance)
setState('isOpen', true)
setState('items', items => [...items, newItem])
```

---

### Async Data
```ts
// createResource — for async data fetching
const [order] = createResource(orderId, fetchOrder)
// orderId is the source signal — refetches when orderId() changes

return (
  <Suspense fallback={<Spinner />}>
    <Show when={order()}>
      {(data) => <OrderDetail order={data()} />}
    </Show>
  </Suspense>
)
```

---

### Lifecycle
- `onMount` — after initial render, DOM is available
- `onCleanup` — cleanup when component unmounts or effect re-runs
- No `componentDidUpdate` equivalent — use `createEffect` with specific signals

---

### What to verify after Solid changes
1. Are any props or signals destructured outside JSX/effects? Fix them.
2. Are all lists rendered with `<For>`, not `.map()`?
3. Are conditionals using `<Show>` or `<Switch>`, not `&&` or ternaries?
4. Are cleanup functions registered with `onCleanup` in effects?
5. `tsc --noEmit` passes