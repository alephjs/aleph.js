# Contributing to Aleph.js

Welcome, and thank you for taking time in contributing to Aleph.js! You can improve Aleph.js in different ways:

- ∆ add new features
- ✘ bugfix
- ✔︎ review code
- ☇ write plugins
- 𝔸 improve our [documentation](https://github.com/alephjs/alephjs.org)

## Development Setup

You will need [Deno](https://deno.land/) 1.7+.

1. Fork this repository to your own GitHub account.
2. Clone the repository to your local device.
3. Create a new branch `git checkout -b BRANCH_NAME`.
4. Change code then run our examples.

```bash
# ssr
deno run -A --unstable --import-map=import_map.json --location=http://localhost cli.ts dev ./examples/hello-world -L debug
# ssg
deno run -A --unstable --import-map=import_map.json --location=http://localhost cli.ts build ./examples/hello-world -L debug
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
- **/examples** examples
- **/plugins** official plugins
- **/server** server code
- **/shared** shared code
- **/test** testings

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
