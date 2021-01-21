# Aleph.js Compiler
The compiler of Aleph.js written in Rust, powered by [swc](https://github.com/swc-project/swc).

## Development Setup

You will need [rust](https://www.rust-lang.org/tools/install) 1.30+ and [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/).

## Build

```bash
deno run -A build.ts
```

## Run tests

```bash
cargo test --all
```

## Benchmark

```bash
deno run -A build.ts && deno run -A benchmark.ts
```
