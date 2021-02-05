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
5. Run all tests.
6. Push your changes to Github.
7. Make a [pull request](https://github.com/alephjs/aleph.js/pulls).
8. Marge to master branch.

```bash
# set dev env
echo 'ALEPH_DEV_PORT=2021' > .local.env

# ssr/development with HMR
deno run -A cli.ts dev ./examples/hello-world -L debug

# ssr/production
deno run -A cli.ts start ./examples/hello-world -L debug

# ssg
deno run -A cli.ts build ./examples/hello-world -L debug

# run all tests:
deno test -A --location=http://localhost
```

## Project Structure

- **/cli** commands code
- **/compiler** compiler in rust powered by swc
- **/framework**
  - **core** framework core code
  - **react** framework in React
- **/design** design drawings and assets
- **/examples** examples
- **/plugins** official plugins
- **/server** server code
- **/shared** shared code

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
