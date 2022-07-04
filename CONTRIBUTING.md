# Contributing to Aleph.js

Welcome, and thank you for taking time in contributing to Aleph.js! You can contribute to Aleph.js in different ways:

- Submit new features
- Report and fix bugs
- Review code
- Improve our [documentation](https://github.com/alephjs/alephjs.org)

## Development Setup

You will need [Deno](https://deno.land/) 1.20+.

1. Fork this repository to your own GitHub account.
2. Clone the repository to your local device.
3. Create a new branch `git checkout -b BRANCH_NAME`.
4. Change code then run the examples.
5. [Push your branch to Github after all tests passed.](#Testing)
6. Make a [pull request](https://github.com/alephjs/aleph.js/pulls).
7. Merge to master branch by our maintainers.

### Run The Examples

```bash
# run the example app in development mode
deno run -A examples/*/dev.ts

# run the example app in production mode
deno run -A examples/*/server.{ts|tsx}
```

**Examples**: https://github.com/alephjs/aleph.js/tree/main/examples

## Testing

You can run all the testings by the following command:

```bash
deno test -A
```

## Project Structure

- **/examples** examples to get started
- **/framework**
  - **core** framework core
  - **react** framework in React
  - **vue** framework in Vue.js
- **/lib** shared libraries
- **/loaders** builtin loaders
- **/server** server core of Aleph.js
- **/tests** unit/integration testings

## Code Style We Followed

- Double quote for string
- Ends with semicolon
- 2 spaces indent
- Types everything
- Order the imports
- Remove unused code
- Format code before commit

```bash
deno fmt **/*.{ts,tsx}
```

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
