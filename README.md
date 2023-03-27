[![Aleph.js: The Full-stack Framework in Deno.](.github/poster.svg)](https://alephjs.org)

<p>
  <a href="https://discord.gg/pWGdS7sAqD"><img src="https://img.shields.io/discord/775256646821085215?color=%23008181&label=Chat&labelColor=%23111&logo=discord&logoColor=%23aaaaaa" alt="Chat"></a>
  <a href="https://twitter.com/intent/follow?screen_name=alephjs"><img src="https://img.shields.io/twitter/follow/alephjs?style=social" alt="Twitter"></a>
</p>

> ⚠️ Not yet 1.0. Many things are subject to change. Documentation is lacking in many places. Try it out and give us
> feedback!

Some demo apps deployed to [Deno Deploy](https://deno.com/deploy) with the new architecture:

- React App: https://aleph-hello.deno.dev/
- REST API: https://aleph-api.deno.dev/
- React 18 Suspense SSR: https://aleph-suspense-ssr.deno.dev/
- UnoCSS(tailwind): https://aleph-unocss.deno.dev/
- Monaco Editor: https://aleph-monaco-editor.deno.dev/
- Yew SSR: https://aleph-yew.deno.dev/
- Github OAuth Middleware: https://aleph-github-oauth.deno.dev/

> **Source code**: https://github.com/alephjs/aleph.js/tree/main/examples

## Real-world Apps

- Deno Deploy: https://dash.deno.com
- Meet Me: https://meet-me.deno.dev ([source](https://github.com/denoland/meet-me))

## Get started

Initialize a new project, you can pick a start template with `--template` flag, available templates:
`[react, react-mdx, api, yew]`

```bash
deno run -A -r https://alephjs.org/init.ts
```

after `init`, you can run the app with deno tasks:

```bash
# go to the app root created by the `init`
cd APPDIR

# run the app in devlopment mode
deno task dev

# run the app in production mode
deno task start
```

## Documentation

> The new docs site is working in progress: https://aleph.deno.dev
> ([PR](https://github.com/alephjs/alephjs.org/pull/58)). You can join the Aleph.js
> [Discord](https://discord.com/invite/pWGdS7sAqD) to get helps.
