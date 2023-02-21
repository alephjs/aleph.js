import { Untar } from "https://deno.land/std@0.175.0/archive/untar.ts";
import { parse } from "https://deno.land/std@0.175.0/flags/mod.ts";
import { blue, bold, cyan, dim, green, red } from "https://deno.land/std@0.175.0/fmt/colors.ts";
import { copy } from "https://deno.land/std@0.175.0/streams/copy.ts";
import { readerFromStreamReader } from "https://deno.land/std@0.175.0/streams/reader_from_stream_reader.ts";
import { ensureDir } from "https://deno.land/std@0.175.0/fs/ensure_dir.ts";
import { basename, join } from "https://deno.land/std@0.175.0/path/mod.ts";

const templates = [
  "react",
  "react-mdx",
  "vue",
  "yew",
  "leptos",
  "solid",
  "api",
  // todo:
  // "preact",
  // "svelte",
  // "lit",
  // "vanilla",
];

const versions = {
  react: "18.2.0",
  vue: "3.2.39",
  solid: "1.5.5",
};

type Options = {
  canary?: boolean;
  template?: string;
};

export default async function init(nameArg?: string, options?: Options) {
  let { template, canary } = options || {};

  // get and check the project name
  const name = nameArg ?? await ask("Project Name:");
  if (!name) {
    console.error(`${red("!")} Please entry project name.`);
    Deno.exit(1);
  }

  if (template && !(templates.includes(template))) {
    console.error(
      `${red("!")} Invalid template name ${red(template)}, must be one of [${blue(templates.join(","))}]`,
    );
    Deno.exit(1);
  }

  // check the dir is clean
  if (
    !(await isFolderEmpty(Deno.cwd(), name)) &&
    !(await confirm(`Folder ${blue(name)} already exists, continue?`))
  ) {
    Deno.exit(1);
  }

  if (!template) {
    const answer = await ask(
      [
        "Select a framework:",
        ...templates.map((name, i) => `  ${bold((i + 1).toString())}. ${toTitle(name)}`),
        dim(`[1-${templates.length}]`),
      ].join("\n"),
    );
    const n = parseInt(answer);
    if (!isNaN(n) && n > 0 && n <= templates.length) {
      template = templates[n - 1];
    } else {
      console.error(`${red("!")} Please entry ${cyan(`[1-${templates.length}]`)}.`);
      Deno.exit(1);
    }
  }

  const generateExportTs = await confirm(
    "Generate `_export.ts` file for runtime that doesn't support dynamic import (deploy to Deno Deploy)?",
  );

  const withUnocss = ["react", "yew", "leptos", "solid"].includes(template!) &&
    await confirm("Using Unocss(TailwindCSS)?");

  const withVscode = await confirm("Initialize VS Code workspace configuration?");

  // download template
  console.log(`${dim("↓")} Downloading template(${blue(template!)}), this might take a moment...`);
  const pkgName = canary ? "aleph_canary" : "aleph";
  const res = await fetch(
    `https://cdn.deno.land/${pkgName}/meta/versions.json`,
  );
  if (res.status !== 200) {
    console.error(await res.text());
    Deno.exit(1);
  }
  const { latest: VERSION } = await res.json();
  const repo = canary ? "ije/aleph-canary" : "alephjs/aleph.js";
  const resp = await fetch(
    `https://codeload.github.com/${repo}/tar.gz/refs/tags/${VERSION}`,
  );
  if (resp.status !== 200) {
    console.error(await resp.text());
    Deno.exit(1);
  }
  // deno-lint-ignore ban-ts-comment
  // @ts-ignore
  const gz = new DecompressionStream("gzip");
  const entryList = new Untar(
    readerFromStreamReader(resp.body!.pipeThrough<Uint8Array>(gz).getReader()),
  );
  const appDir = join(Deno.cwd(), name);
  const prefix = `${basename(repo)}-${VERSION}/examples/${withUnocss ? "with-unocss/" : ""}${template}-app/`;

  // write template files
  for await (const entry of entryList) {
    if (entry.fileName.startsWith(prefix) && !entry.fileName.endsWith("/README.md")) {
      const fp = join(appDir, trimPrefix(entry.fileName, prefix));
      if (entry.type === "directory") {
        await ensureDir(fp);
        continue;
      }
      const file = await Deno.open(fp, { write: true, create: true });
      await copy(entry, file);
    }
  }

  let serverCode = await Deno.readTextFile(join(appDir, "server.ts"));
  if (!generateExportTs) {
    const importExpr = `import routes from "./routes/_export.ts";\n`;
    if (serverCode.includes(importExpr)) {
      serverCode = serverCode
        .replace(importExpr, "")
        .replace("  router: { routes },\n", "")
        .replace("    routes,\n  },", "  },");
      await Deno.writeTextFile(
        join(appDir, "dev.ts"),
        [`import dev from "aleph/dev";`, "dev();"].join("\n\n"),
      );
      await Deno.remove(join(appDir, "routes/_export.ts"));
    }
  }
  await Deno.writeTextFile(
    join(appDir, "server.ts"),
    serverCode.replace("  baseUrl: import.meta.url,\n", ""),
  );

  const alephPkgUri = `https://deno.land/x/${pkgName}@${VERSION}`;
  const denoConfig = {
    "compilerOptions": {
      "lib": [
        "dom",
        "dom.iterable",
        "dom.extras",
        "deno.ns",
      ],
      "types": [
        `${alephPkgUri}/types.d.ts`,
      ],
    },
    "importMap": "import_map.json",
    "tasks": {
      "dev": "deno run -A dev.ts",
      "start": "deno run -A server.ts",
      "build": "deno run -A server.ts --build",
    },
  };
  const importMap = {
    imports: {
      "~/": "./",
      "std/": "https://deno.land/std@0.175.0/",
      "aleph/": `${alephPkgUri}/`,
      "aleph/server": `${alephPkgUri}/server/mod.ts`,
      "aleph/dev": `${alephPkgUri}/server/dev.ts`,
    } as Record<string, string>,
    scopes: {},
  };
  if (withUnocss) {
    Object.assign(importMap.imports, {
      "@unocss/core": "https://esm.sh/@unocss/core@0.47.4",
      "@unocss/preset-uno": "https://esm.sh/@unocss/preset-uno@0.47.4",
    });
  }
  switch (template) {
    case "react-mdx":
      Object.assign(importMap.imports, {
        "aleph/react/mdx-loader": `${alephPkgUri}/runtime/react/mdx-loader.ts`,
        "@mdx-js/react": "https://esm.sh/@mdx-js/react@2.1.5",
      });
      /* falls through */
    case "react": {
      Object.assign(denoConfig.compilerOptions, {
        "jsx": "react-jsx",
        "jsxImportSource": `https://esm.sh/react@${versions.react}`,
      });
      Object.assign(importMap.imports, {
        "aleph/react": `${alephPkgUri}/runtime/react/mod.ts`,
        "aleph/react-client": `${alephPkgUri}/runtime/react/client.ts`,
        "aleph/react-server": `${alephPkgUri}/runtime/react/server.ts`,
        "react": `https://esm.sh/react@${versions.react}`,
        "react-dom": `https://esm.sh/react-dom@${versions.react}`,
        "react-dom/": `https://esm.sh/react-dom@${versions.react}/`,
      });
      break;
    }
    case "vue": {
      Object.assign(importMap.imports, {
        "aleph/vue": `${alephPkgUri}/runtime/vue/mod.ts`,
        "aleph/vue-server": `${alephPkgUri}/runtime/vue/server.ts`,
        "vue": `https://esm.sh/vue@${versions.vue}`,
        "@vue/server-renderer": `https://esm.sh/@vue/server-renderer@${versions.vue}`,
      });
      break;
    }
    case "solid": {
      Object.assign(denoConfig.compilerOptions, {
        "jsx": "react-jsx",
        "jsxImportSource": `https://esm.sh/solid-js@${versions.solid}`,
      });
      Object.assign(importMap.imports, {
        "aleph/solid-server": `${alephPkgUri}/runtime/solid/server.ts`,
        "solid-js": `https://esm.sh/solid-js@${versions.solid}`,
        "solid-js/web": `https://esm.sh/solid-js@${versions.solid}/web`,
        "solid-refresh": "https://esm.sh/solid-refresh@0.4.1",
      });
      break;
    }
  }

  await ensureDir(appDir);
  await Promise.all([
    Deno.writeTextFile(
      join(appDir, "deno.json"),
      JSON.stringify(denoConfig, undefined, 2),
    ),
    Deno.writeTextFile(
      join(appDir, "import_map.json"),
      JSON.stringify(importMap, undefined, 2),
    ),
  ]);

  if (withVscode) {
    const settings = {
      "deno.enable": true,
      "deno.lint": true,
      "deno.config": "./deno.json",
    };
    await ensureDir(join(appDir, ".vscode"));
    await Deno.writeTextFile(
      join(appDir, ".vscode", "settings.json"),
      JSON.stringify(settings, undefined, 2),
    );
  }

  await Deno.run({
    cmd: [Deno.execPath(), "cache", "server.ts"],
    cwd: appDir,
    stderr: "inherit",
    stdout: "inherit",
  }).status();

  console.log([
    "",
    green("▲ Aleph.js is ready to go!"),
    "",
    `${dim("$")} cd ${name}`,
    `${dim("$")} deno task dev    ${dim("# Start the server in `development` mode")}`,
    `${dim("$")} deno task start  ${dim("# Start the server in `production` mode")}`,
    `${dim("$")} deno task build  ${dim("# Build & Optimize the app (bundling, SSG, etc.)")}`,
    "",
    `Docs: ${cyan("https://alephjs.org/docs")}`,
    `Bugs: ${cyan("https://github.com/alephjs/aleph.js/issues")}`,
    "",
  ].join("\n"));
  Deno.exit(0);
}

async function isFolderEmpty(root: string, name: string): Promise<boolean> {
  const dir = join(root, name);
  if (await existsFile(dir)) {
    throw new Error(`Folder ${name} already exists as a file.`);
  }
  if (await existsDir(dir)) {
    for await (const file of Deno.readDir(dir)) {
      if (file.name !== ".DS_Store") {
        return false;
      }
    }
  }
  return true;
}

async function ask(question = ":") {
  await Deno.stdout.write(new TextEncoder().encode(cyan("? ") + question + " "));
  const buf = new Uint8Array(1024);
  const n = <number> await Deno.stdin.read(buf);
  const answer = new TextDecoder().decode(buf.subarray(0, n));
  return answer.trim();
}

async function confirm(question = "are you sure?") {
  let a: string;
  // deno-lint-ignore no-empty
  while (!/^(y|n|)$/i.test(a = await ask(question + dim(" [y/N]")))) {}
  return a.toLowerCase() === "y";
}

function trimPrefix(s: string, prefix: string): string {
  if (prefix !== "" && s.startsWith(prefix)) {
    return s.slice(prefix.length);
  }
  return s;
}

function toTitle(name: string) {
  if (name === "api") {
    return "REST API";
  }
  if (name === "react-mdx") {
    return "React with MDX";
  }
  return name.at(0)?.toUpperCase() + name.slice(1);
}

/** Check whether or not the given path exists as a directory. */
export async function existsDir(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isDirectory;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

/** Check whether or not the given path exists as regular file. */
export async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

if (import.meta.main) {
  const { _: args, ...options } = parse(Deno.args);
  await init(args[0] as string | undefined, options);
}
