# Contributing to Aleph.js

Welcome, and thank you for taking time in contributing to Aleph.js!

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development Setup

You will need [Deno](https://deno.land/) 1.4+ and [VS Code](https://code.visualstudio.com/) with [deno extension](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno).

1. Fork this repository to your own GitHub account.
2. Clone the repository to your local device.
3. Create a new branch `git checkout -b BRANCH_NAME`.
4. Change code then run examples.

```bash
deno run -A --unstable --importmap=import_map.json cli.ts ./examples/hello-world --log=debug
```

## Testing

Run all tests:

```bash
deno test -A --unstable
```

## Contributing to Documentation

You are welcome to improve our documentation, the documentation repository is https://github.com/postui/alephjs.org/tree/master/pages/docs.
