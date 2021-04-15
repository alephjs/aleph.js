# Contributing to Aleph.js

Welcome, and thank you for taking time in contributing to Aleph.js! You can improve Aleph.js in different ways:

- ∆ add new features
- ✘ bugfix
- ✔︎ review code
- ☇ write plugins
- 𝔸 improve our [documentation](https://github.com/alephjs/alephjs.org)

## Development Setup

You will need [Deno](https://deno.land/) 1.8+.

1. Fork this repository to your own GitHub account.
2. Clone the repository to your local device.
3. Create a new branch `git checkout -b BRANCH_NAME`.
4. Change code then run the examples.
5. Push your branch to Github after all tests passed.
6. Make a [pull request](https://github.com/alephjs/aleph.js/pulls).
7. Marge to master branch by our maintainers.

```bash
# ssr/development with HMR
ALEPH_DEV=true deno run -A --unstable --import-map=./import_map.json cli.ts dev ./examples/hello-world -L debug

# ssr/production
ALEPH_DEV=true deno run -A --unstable --import-map=./import_map.json cli.ts start ./examples/hello-world -L debug

# ssg
ALEPH_DEV=true deno run -A --unstable --import-map=./import_map.json cli.ts build ./examples/hello-world -L debug

# run all tests
deno test -A --unstable --import-map=./import_map.json
```

## Project Structure

- **/bundler** bundler for production mode
- **/cli** commands code
- **/compiler** compiler in rust powered by swc
- **/framework**
  - **core** framework core code
  - **react** framework in React
- **/design** design drawings and assets
- **/examples** examples
- **/plugins** plugins
- **/server** server code
- **/shared** shared code

## Commit Message Guidelines

We have very precise rules over how our git commit messages can be formatted. This leads to **more
readable messages** that are easy to follow when looking through the **project history**.

### Commit Message Format

Each commit message consists of a **header**, a **body** and a **footer**. The header has a special
format that includes a **type**, a **scope** and a **subject**:

```
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>
```

The **header** is mandatory and the **scope** of the header is optional.

Any line of the commit message cannot be longer 100 characters! This allows the message to be easier
to read on GitHub as well as in various git tools.

Footer should contain a [closing reference to an issue](https://help.github.com/articles/closing-issues-via-commit-messages/) if any.

Samples:

```
docs(changelog): update change log to 0.0.9
```


## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
