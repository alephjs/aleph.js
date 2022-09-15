// deno run -A examples/react-app/server.ts
Deno.bench("react server-side rendering", async () => {
  await fetch("http://localhost:3000");
});

// deno run -A examples/vue-app/server.ts --port 3001
Deno.bench("vue server-side rendering", async () => {
  await fetch("http://localhost:3001");
});

// deno run -A examples/solid-app/server.ts --port 3002
Deno.bench("solid server-side rendering", async () => {
  await fetch("http://localhost:3002");
});

// deno run -A examples/yew-app/server.ts --port 3003
Deno.bench("yew server-side rendering", async () => {
  await fetch("http://localhost:3003");
});
