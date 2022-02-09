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
5. [Push your branch to Github after all tests passed.](#Testing)
6. Make a [pull request](https://github.com/alephjs/aleph.js/pulls).
7. Merge to master branch by our maintainers.

```bash
# ssr/development with HMR
ALEPH_DEV=true deno run -A cli.ts dev ./examples/hello-react -L debug

# ssr/production
ALEPH_DEV=true deno run -A cli.ts start ./examples/hello-react -L debug
```

## Testing

You can run all tests with the following command:

```bash
$ deno test -A --unstable --location=http://localhost -c=deno.json --import-map=import_map.json
```

After running `integration_test.ts`, a zombie subprocesse may remain alive. (See [denoland/deno#7087](https://github.com/denoland/deno/issues/7087) for details) You can get rid of it with the following command:

```shell
# On Unix
$ kill $(lsof -i:8080 -t)
```

## Project Structure

- **/bundler** bundler for production mode
- **/commands** commands to start
- **/compiler** a JS/TS/JSX compiler written in rust powered by swc
- **/framework**
  - **core** framework core
  - **react** framework in React
- **/examples** examples to learn
- **/server** server to run apps
- **/shared** shared code

## Code Style We Followed

- Single quote for string
- No semicolons
- 2 spaces indent
- Types everything
- Order your imports
- Remove unused variables
- Format code before commit

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
