import { Import, useDeno } from "https://deno.land/x/aleph/mod.ts";
import React, { useState } from "https://esm.sh/react";
import Logo from "../components/logo.tsx";

export default function Home() {
  const [count, setCount] = useState(0);
  const version = useDeno(() => {
    return Deno.version;
  });

  return (
    <div className="page">
      <Import from="../style/index.less" />
      <p className="logo"><Logo /></p>
      <h1>Welcome to use <strong>Aleph.js</strong>!</h1>
      <p className="links">
        <a href="https://alephjs.org" target="_blank">Website</a>
        <span>&middot;</span>
        <a href="https://alephjs.org/docs/get-started" target="_blank">
          Get Started
        </a>
        <span>&middot;</span>
        <a href="https://alephjs.org/docs" target="_blank">Docs</a>
        <span>&middot;</span>
        <a href="https://github.com/alephjs/aleph.js" target="_blank">Github</a>
      </p>
      <p className="counter">
        <span>Counter:</span>
        <strong>{count}</strong>
        <button onClick={() => setCount((n) => n - 1)}>-</button>
        <button onClick={() => setCount((n) => n + 1)}>+</button>
      </p>
      <p className="copyinfo">Built by Aleph.js in Deno v{version.deno}</p>
    </div>
  );
}
