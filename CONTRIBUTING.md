# Contributing to Aleph.js

Welcome, and thank you for taking time in contributing to Aleph.js! You can help us in different ways:

- ∆ add new feature
- ✘ bugfix
- ✔︎ review code
- ☇ write plugins
- 𝔸 improve our [documentation](https://github.com/alephjs/alephjs.org)

## Development Setup

You will need [Deno](https://deno.land/) 1.5+ and [VS Code](https://code.visualstudio.com/) with [deno extension](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno).

1. Fork this repository to your own GitHub account.
2. Clone the repository to your local device.
3. Create a new branch `git checkout -b BRANCH_NAME`.
4. Change code then run our examples.

```bash
# ssr
deno run -A --unstable --import-map=import_map.json cli.ts dev ./examples/hello-world -L debug
# ssg
deno run -A --unstable --import-map=import_map.json cli.ts build ./examples/hello-world -L debug
```

## Testing

Run all tests:

```bash
deno test -A
```

## Project Structure

- **/cli** command code
- **/compiler** compiler in rust with swc
- **/framework** framework code
- **/design** design drawings and assets
- **/examples** some examples
- **/plugins** official plugins
- **/shared** shared code
- **/test** testings
- **/vendor** packages from npm

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
