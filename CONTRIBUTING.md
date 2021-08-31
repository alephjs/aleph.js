# Contributing to Aleph.js

Welcome, and thank you for taking time in contributing to Aleph.js! You can improve Aleph.js in different ways:

- ∆ submit new features
- ✘ find bugs
- ✔︎ review code
- ☇ write plugins
- 𝔸 improve our [documentation](https://github.com/alephjs/alephjs.org)

## Development Setup

You will need [Deno](https://deno.land/) 1.13+.

1. Fork this repository to your own GitHub account.
2. Clone the repository to your local device.
3. Create a new branch `git checkout -b BRANCH_NAME`.
4. Change code then run the examples.
5. Push your branch to Github after all tests passed.
6. Make a [pull request](https://github.com/alephjs/aleph.js/pulls).
7. Merge to master branch by our maintainers.

```bash
# ssr/development with HMR
ALEPH_DEV=true deno run -A --unstable --location=http://localhost cli.ts dev ./examples/hello-world -L debug

# ssr/production
ALEPH_DEV=true deno run -A --unstable --location=http://localhost cli.ts start ./examples/hello-world -L debug

# ssg
ALEPH_DEV=true deno run -A --unstable --location=http://localhost cli.ts build ./examples/hello-world -L debug

# run all tests
deno test -A --unstable --location=http://localhost --import-map=./import_map.json
```

## Project Structure

- **/bundler** bundler for production mode
- **/commands** commands to start
- **/compiler** a JS/TS/JSX compiler written in rust powered by swc
- **/framework**
  - **core** framework core
  - **react** framework in React
- **/design** design drawings and assets
- **/examples** examples to learn
- **/plugins** official plugins
- **/server** server to run apps
- **/shared** shared code

## Code Style We Followed

- Single quote for string
- No semicolons
- 2 spaces indent
- Types everything
- Order your imports
- Format code using vscode default TS Server

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
