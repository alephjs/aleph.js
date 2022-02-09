[![Aleph.js: The Full-stack Framework in Deno.](.github/poster.svg)](https://alephjs.org)

<p>
  <a href="https://discord.gg/pWGdS7sAqD"><img src="https://img.shields.io/discord/775256646821085215?color=%23008181&label=Chat&labelColor=%23111&logo=discord&logoColor=%23aaaaaa" alt="Chat"></a>
  <a href="https://twitter.com/intent/follow?screen_name=alephjs"><img src="https://img.shields.io/twitter/follow/alephjs?style=social" alt="Twitter"></a>
</p>

## Getting Started

Visit [https://alephjs.org/docs/get-started](https://alephjs.org/docs/get-started) to get started with Aleph.js.


## Description

Aleph.js (or **Aleph** or **א** or **阿莱夫**, **ˈɑːlɛf**) is a fullstack framework in [Deno](https://deno.land/).

> The name is taken from the book [_The Aleph_]( http://phinnweb.org/links/literature/borges/aleph.html)
 by [Jorge Luis Borges](http://phinnweb.org/links/literature/borges/aleph.html).

Aleph.js is a modern tool to build your web applications. It transpiles code using [swc](https://swc.rs/) with high performance, and bundles modules with [esbuild](https://github.com/evanw/esbuild) at build time extremely fast.

Aleph.js works in Deno, a simple, modern and secure runtime for JavaScript and TypeScript. All dependencies are imported using URLs, and managed by Deno cache system. No `package.json` and `node_modules` directory needed.

```ts
import React from 'https://esm.sh/react'
import Logo from '../components/logo.tsx'

export default function App() {
  return (
    <div>
      <Logo />
      <h1>Hello World!</h1>
    </div>
  )
}
```

## Community

The Aleph.js community can be found on [GitHub Discussions](https://github.com/alephjs/aleph.js/discussions), where you can ask questions, voice ideas, and share your projects.

To chat with other community members you can join the Aleph.js [Discord](https://discord.com/invite/pWGdS7sAqD).

## Contributing

Please see our [contributing.md](https://github.com/alephjs/aleph.js/blob/master/CONTRIBUTING.md).

## License

[MIT licensed.](https://github.com/alephjs/aleph.js/blob/master/LICENSE)
