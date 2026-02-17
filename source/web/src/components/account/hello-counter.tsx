import { createSignal } from "solid-js";

export default function HelloCounter() {
  const [count, setCount] = createSignal(0);

  return (
    <div class="counter">
      <p>Hello from Solid.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Count: {count()}
      </button>
    </div>
  );
}
