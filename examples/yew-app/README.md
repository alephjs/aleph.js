# Yew App

This is a demo application powered by Aleph.js in Deno using [Yew](https://yew.rs/) SSR.

- 🚀 Both the client-side rendering (CSR) and server-side rendering (SSR) use
  **[WebAssembly](https://webassembly.org/)**, delivering great performance on modern browsers and serverless platforms
  at the edge.
- 🦀 To use this application, you will need [rust](https://www.rust-lang.org/tools/install) version **1.56+** and
  [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/).
- 🦕 This application can be deployed with [Deno Deploy](https://deno.com/deploy) at https://aleph-yew.deno.dev/

## Running the Example Locally

```bash
# Run the example app in development mode
deno run -A examples/yew-app/dev.ts

# Run the example app in production mode
deno run -A examples/yew-app/server.ts
```

## Using as a Template

```bash
deno run -A -r https://alephjs.org/init.ts --template=yew
```
