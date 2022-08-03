import { createSignal } from "solid-js";

function Counter() {
  const [count, setCount] = createSignal(0);
  const increment = () => setCount(count() + 1);

  return (
    <button type="button" onClick={increment}>
      {count() + 1}
    </button>
  );
}

export default function App() {
  return (
    <div>
      <h1>Solid.js + Aleph.js</h1>
      <p>
        <Counter />
      </p>
    </div>
  );
}
