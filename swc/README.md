# Aleph.js Compiler
The compiler of Aleph.js written in Rust, powered by [swc](https://github.com/swc-project/swc).

## Development Setup

You will need [rust](https://www.rust-lang.org/tools/install) 1.30+ and [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/).

## Build

```bash
sh ./build.sh
```

## Run tests

```bash
cargo test --all
```

## Banchmark

```bash
wasm-pack build --target web
deno run -A banchmark.ts
```
