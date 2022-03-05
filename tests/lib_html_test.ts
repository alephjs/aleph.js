import { assertEquals } from "std/testing/asserts.ts";
import { parseHtmlLinks } from "../lib/html.ts";

Deno.test("lib/html.ts: parseHtmlLinks", async () => {
  const html = `<!DOCTYPE html>
  <html lang="en">

  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="./assets/logo.svg">
    <link rel="stylesheet" href="./style/app.css">
    <ssr-head>
  </head>

  <body>
    <div id="root"><ssr-body></div>
    <script type="module" src="./main.tsx"></script>
  </body>

  </html>
  `;
  const links = await parseHtmlLinks(html);
  assertEquals(links, ["./assets/logo.svg", "./style/app.css", "./main.tsx"]);
});
