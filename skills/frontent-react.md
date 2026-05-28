## React Conventions

Read frontend.md first. This covers React-specific patterns.

---

### Component Rules
- Functional components only — no class components
- One component per file — file name matches component name exactly
- Named exports only:
```ts
  // Wrong
  export default function OrderCard() { ... }
  // Right
  export function OrderCard() { ... }
```
  Exception: Next.js page files require default export
- Props typed as `type` directly above the component:
```ts
  type OrderCardProps = {
    order: Order
    onSelect: (id: string) => void
    isSelected?: boolean
  }
  export function OrderCard({ order, onSelect, isSelected = false }: OrderCardProps) { ... }
```
- Never spread unknown props onto DOM elements — it causes React warnings
  and passes invalid HTML attributes

---

### Hooks
- Never call hooks conditionally — ever
- `useEffect` dependency arrays must be complete and accurate
  — if you find yourself adding eslint-disable, redesign the effect
- Custom hooks always start with `use`
- If a custom hook is used in more than one component, move it to `hooks/`
- If a hook feels too large, it probably contains multiple concerns — split it

#### When to use each hook
- `useState` — simple local state, independent values
- `useReducer` — complex local state, multiple values that change together,
  state machines
- `useMemo` — expensive computations only, not object identity stabilization
  for children props (profile first)
- `useCallback` — only when passing callbacks to heavily memoized children
  or as useEffect/useMemo deps — not by default
- `useRef` — DOM refs, mutable values that do not trigger re-render
- `useContext` — only for truly global/ambient data (theme, locale, auth)
  not for component communication — use Zustand for that

---

### State — Three Layers, No Overlap

#### Layer 1: Local state (useState / useReducer)
- Component-scoped, does not need to be shared
- Default choice for UI state: open/closed, selected tab, form field values

#### Layer 2: Client state (Zustand)
- Shared across multiple unrelated components
- Does NOT include anything that comes from the server
- Store structure — sliced by domain:
```ts
  // stores/cart.store.ts
  type CartState = {
    items: CartItem[]
    isOpen: boolean
  }
  type CartActions = {
    addItem: (item: CartItem) => void
    removeItem: (id: string) => void
    toggleCart: () => void
    clear: () => void
  }
  
  export const useCartStore = create<CartState & CartActions>()(
    immer((set) => ({
      items: [],
      isOpen: false,
      addItem: (item) => set((state) => {
        const existing = state.items.find(i => i.id === item.id)
        if (existing) { existing.quantity += 1 }
        else { state.items.push(item) }
      }),
      removeItem: (id) => set((state) => {
        state.items = state.items.filter(i => i.id !== id)
      }),
      toggleCart: () => set((state) => { state.isOpen = !state.isOpen }),
      clear: () => set(() => ({ items: [], isOpen: false })),
    }))
  )
```
- Selectors with multiple fields use `useShallow`:
```ts
  const { items, total } = useCartStore(
    useShallow(s => ({ items: s.items, total: s.total }))
  )
```
- Read the existing store before adding to it — the slice may already exist

#### Layer 3: Server state (React Query)
- Everything that comes from the server lives here — not in Zustand
- Query keys in `queryKeys.ts` — never inline:
```ts
  // queryKeys.ts
  export const queryKeys = {
    orders: {
      all: ['orders'] as const,
      lists: () => [...queryKeys.orders.all, 'list'] as const,
      list: (filters: OrderFilters) =>
        [...queryKeys.orders.lists(), filters] as const,
      details: () => [...queryKeys.orders.all, 'detail'] as const,
      detail: (id: string) => [...queryKeys.orders.details(), id] as const,
    },
  }
```
- Read `queryKeys.ts` before adding new keys
- Always set `staleTime` explicitly:
```ts
  useQuery({
    queryKey: queryKeys.orders.detail(id),
    queryFn: () => orderApi.getOrder(id),
    staleTime: 1000 * 60 * 5,  // 5 minutes
  })
```
- Mutations always invalidate related queries:
```ts
  useMutation({
    mutationFn: (data: CreateOrderData) => orderApi.createOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.lists() })
    },
    onError: (error) => {
      // handle ProblemDetails error
    },
  })
```
- Optimistic updates only when explicitly asked — they increase complexity
- Do not call `mutateAsync` wrapped in try/catch unless you need the error
  locally — use `onError` callback instead

---

### Error Handling in UI
- Error boundaries wrap route-level components and async boundaries
- Use the existing error boundary component — do not write a new one
- React Query errors surface via `isError` + `error` from `useQuery` —
  render an error state, not a thrown error
- Do not use `console.error` for user-facing errors — use the existing
  notification/toast system

---

### Performance
- Do not memoize prematurely — profile first
- `React.memo` only for components that receive stable props and re-render often
- `useMemo` only for genuinely expensive computations (>1ms)
- `useCallback` only when the function is a dep in another hook or passed
  to a memoized child
- Avoid large component trees under a single context provider
- Virtualize long lists (read what library the project uses before adding one)

---

### What to verify after React changes
1. Are all hook call sites at the top level of the component?
2. Are useEffect dependencies complete?
3. Does every mutation invalidate the right query keys?
4. Are Zustand multi-field selectors wrapped in useShallow?
5. `tsc --noEmit` passes