![Aleph Poster](./design/poster.svg)

# Aleph.js

The React Framework in [Deno](https://deno.land), inspired by [Next.js](https://nextjs.org).
<br>
[Website](https://alephjs.org) | [Get Started](https://alephjs.org/docs/get-started)  | [Docs](https://alephjs.org/docs) | [ESM](https://esm.sh) | [The Aleph  (by Jorge Luis Borges)](http://www.phinnweb.org/links/literature/borges/aleph.html)

[![Aleph.js in Deno](https://github.com/alephjs/aleph.js/workflows/Aleph.js%20in%20Deno/badge.svg)](https://github.com/alephjs/aleph.js/actions?query=workflow%3A%22Aleph.js+in+Deno%22)
[![nest badge](https://nest.land/badge.svg)](https://nest.land/package/aleph)
[![Chat](https://img.shields.io/discord/775256646821085215?color=%23008181&label=Chat&labelColor=%23111&logo=discord&logoColor=%23aaaaaa)](https://discord.com/channels/775256646821085215)
[![Twitter Follow](https://img.shields.io/twitter/follow/alephjs?style=social)](https://twitter.com/intent/follow?screen_name=alephjs)

Different with Next.js, Aleph.js don't need **webpack** or other bundler since Aleph.js use the **ESM** imports syntax. Every module only needs to be compiled once and then cached on the disk. When a module changes, Aleph.js just recompile that single module, there's no time wasted re-bundling every changes, and instant updates in the browser by **HMR** (Hot Module Replacement) with **React Fast Refresh**.

Aleph.js works in **Deno**, a *simple*, *modern* and *secure* runtime for JavaScript and TypeScript. No `package.json` and `node_modules` directory needed, all dependencies are imported as URL and managed by Aleph.js:

```jsx
import React from "https://esm.sh/react"
import Logo from "../components/logo.tsx"

export default function Page() {
    return (
      <div>
        <Logo />
        <h1>Hello World!</h1>
      </div>
    )
}
```

### Features
- Zero Config
- Typescript in Deno
- ES Module Ready
- Import Maps
- HMR with Fast Refresh
- File-system Routing
- Markdown Page
- Built-in CSS(Less) Support
- SSR/SSG

### Installation
```bash
deno install -A -f -n aleph https://deno.land/x/aleph@v0.2.24/cli.ts
```

### Usage
```bash
# create a new app
aleph init hello
cd hello

# start the app in `development` mode
aleph dev

# start the app in `production` mode
aleph start

# build the app to a static site (SSG)
aleph build

# more usages
aleph -h
```

### Documentation
Please visit https://alephjs.org/docs to view the documentation.

### Contributing
Please read the [contributing.md](CONTRIBUTING.md).
