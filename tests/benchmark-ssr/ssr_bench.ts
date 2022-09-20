Deno.bench("react server-side rendering", async () => {
  await fetch("http://localhost:3001/");
});

Deno.bench("vue server-side rendering", async () => {
  await fetch("http://localhost:3002/");
});

Deno.bench("solid server-side rendering", async () => {
  await fetch("http://localhost:3003/");
});

Deno.bench("yew server-side rendering", async () => {
  await fetch("http://localhost:3004/");
});
