# Contributing to Aleph.js

Welcome, and thank you for taking time in contributing to Aleph.js! You can improve Aleph.js in different ways:

- ∆ submit new features
- ✘ find bugs
- ✔︎ review code
- 𝔸 improve our [documentation](https://github.com/alephjs/alephjs.org)

## Development Setup

You will need [Deno](https://deno.land/) 1.18.2+.

1. Fork this repository to your own GitHub account.
2. Clone the repository to your local device.
3. Create a new branch `git checkout -b BRANCH_NAME`.
4. Change code then run the examples.
5. [Push your branch to Github after all tests passed.](#Testing)
6. Make a [pull request](https://github.com/alephjs/aleph.js/pulls).
7. Merge to master branch by our maintainers.

```bash
# run example app in development mode
make dev app=react-app

# run example app in production mode
make dev app=react-app
```

## Testing

You can run all tests with the following command:

```bash
make test
```

## Project Structure

- **/commands** commands of Aleph.js CLI
- **/compiler** the compiler of Aleph.js written in Rust, powered by swc and parcel-css
- **/examples** examples to learn
- **/framework**
  - **core** framework core
  - **react** framework in React
- **/lib** shared lib
- **/loaders** builtin loaders
- **/server** server of Aleph.js

## Code Style We Followed

- Double quote for string
- Semicolons is good
- 2 spaces indent
- Types everything
- Order your imports
- Remove unused variables
- Format code before commit

```bash
deno fmt **/*.(ts|tsx)
```

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
