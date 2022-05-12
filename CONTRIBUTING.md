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

### react-app

```bash
# run the example app in development mode
deno task dev examples/react-app

# run the example app in production mode
deno task start examples/react-app

# build the example app into a worker for serverless platform
deno task build examples/react-app
```

### vue-app

```bash
# run the example app in development mode
deno task dev examples/vue-app

# run the example app in production mode
deno task start examples/vue-app

# build the example app into a worker for serverless platform
deno task build examples/vue-app
```

## Testing

You can run all tests with the following command:

```bash
deno task test
```

## Project Structure

- **/commands** commands of Aleph.js CLI
- **/examples** examples to get started
- **/framework**
  - **core** framework core
  - **react** framework in React
  - **vue** framework in Vue.js
- **/lib** shared lib
- **/loaders** builtin loaders
- **/server** server of Aleph.js

## Code Style We Followed

- Double quote for string
- Semicolons is good
- 2 spaces indent
- Types everything
- Order the imports
- Remove unused code
- Format code before commit

```bash
deno fmt **/*.(ts|tsx)
```

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
