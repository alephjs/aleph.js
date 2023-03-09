import { Untar } from "https://deno.land/std@0.175.0/archive/untar.ts";
import { parse } from "https://deno.land/std@0.175.0/flags/mod.ts";
import { blue, bold, cyan, dim, green, red } from "https://deno.land/std@0.175.0/fmt/colors.ts";
import { copy as copyDir } from "https://deno.land/std@0.175.0/fs/copy.ts";
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
];

const rsApps = [
  "yew",
  "leptos",
];

const unocssApps = [
  "react",
  "yew",
  "leptos",
  "solid",
];

const versions = {
  react: "18.2.0",
  vue: "3.2.39",
  solid: "1.6.12",
};

type Options = {
  template?: string;
};

export default async function init(nameArg?: string, options?: Options) {
  let { template } = options || {};

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
    const answer = await ask([
      "Select a framework:",
      ...templates.map((name, i) => `  ${bold((i + 1).toString())}. ${getTemplateDisplayName(name)}`),
      dim(`[1-${templates.length}]`),
    ].join("\n"));
    const n = parseInt(answer);
    if (!isNaN(n) && n > 0 && n <= templates.length) {
      template = templates[n - 1];
    } else {
      console.error(`${red("!")} Please entry ${cyan(`[1-${templates.length}]`)}.`);
      Deno.exit(1);
    }
  }

  const appDir = join(Deno.cwd(), name);
  const withUnocss = unocssApps.includes(template!) && await confirm("Use Atomic CSS (powered by Unocss)?");
  const withVscode = await confirm("Initialize VS Code workspace configuration?");
  const deploy = !rsApps.includes(template) ? await confirm("Deploy to Deno Deploy?") : false;
  const isRsApp = rsApps.includes(template);

  let alephPkgUri: string;
  if (import.meta.url.startsWith("file://")) {
    const src = `examples/${withUnocss ? "with-unocss/" : ""}${template}-app/`;
    await copyDir(src, name);
    alephPkgUri = "..";
  } else {
    console.log(`${dim("↓")} Downloading template(${blue(template!)}), this might take a moment...`);
    const res = await fetch("https://cdn.deno.land/aleph/meta/versions.json");
    if (res.status !== 200) {
      console.error(await res.text());
      Deno.exit(1);
    }
    const { latest: VERSION } = await res.json();
    const repo = "alephjs/aleph.js";
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
    const prefix = `${basename(repo)}-${VERSION}/examples/${withUnocss ? "with-unocss/" : ""}${template}-app/`;
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
    alephPkgUri = `https://deno.land/x/aleph@${VERSION}`;
  }

  const res = await fetch("https://esm.sh/status.json");
  if (res.status !== 200) {
    console.error(await res.text());
    Deno.exit(1);
  }
  const { version: ESM_VERSION } = await res.json();

  if (!isRsApp && !deploy) {
    const importExpr = `import modules from "./routes/_export.ts";\n`;
    const serverCode = await Deno.readTextFile(join(appDir, "server.ts"));
    if (serverCode.includes(importExpr)) {
      await Deno.writeTextFile(
        join(appDir, "server.ts"),
        serverCode
          .replace(importExpr, "")
          .replace('import denoDeploy from "aleph/plugins/deploy";\n', "")
          .replace("    denoDeploy({ modules }),\n", ""),
      );
      await Deno.remove(join(appDir, "routes/_export.ts"));
    }
  }

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
      "dev": await existsFile(join(appDir, "dev.ts")) ? "deno run -A dev.ts" : `deno run -A ${alephPkgUri}/dev.ts`,
      "start": "deno run -A server.ts",
      "build": "deno run -A server.ts --build",
      "esm:add": `deno run -A https://esm.sh/v${ESM_VERSION} add`,
      "esm:update": `deno run -A https://esm.sh/v${ESM_VERSION} update`,
      "esm:remove": `deno run -A https://esm.sh/v${ESM_VERSION} remove`,
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
  if (deploy) {
    Object.assign(importMap.imports, {
      "aleph/plugins/deploy": `${alephPkgUri}/plugins/deploy.ts`,
    });
  }
  if (withUnocss) {
    Object.assign(importMap.imports, {
      "aleph/plugins/unocss": `${alephPkgUri}/plugins/unocss.ts`,
      "@unocss/core": `https://esm.sh/v${ESM_VERSION}/@unocss/core@0.50.3`,
      "@unocss/preset-uno": `https://esm.sh/v${ESM_VERSION}/@unocss/preset-uno@0.50.3`,
    });
  }
  switch (template) {
    case "react-mdx":
      Object.assign(importMap.imports, {
        "aleph/plugins/mdx": `${alephPkgUri}/plugins/mdx.ts`,
        "@mdx-js/react": `https://esm.sh/v${ESM_VERSION}/@mdx-js/react@2.3.0`,
      });
      /* falls through */
    case "react": {
      Object.assign(denoConfig.compilerOptions, {
        "jsx": "react-jsx",
        "jsxImportSource": `https://esm.sh/v${ESM_VERSION}/react@${versions.react}`,
      });
      Object.assign(importMap.imports, {
        "aleph/react": `${alephPkgUri}/framework/react/mod.ts`,
        "aleph/plugins/react": `${alephPkgUri}/framework/react/plugin.ts`,
        "react": `https://esm.sh/v${ESM_VERSION}/react@${versions.react}`,
        "react-dom": `https://esm.sh/v${ESM_VERSION}/react-dom@${versions.react}`,
        "react-dom/": `https://esm.sh/v${ESM_VERSION}/react-dom@${versions.react}/`,
      });
      break;
    }
    case "vue": {
      Object.assign(importMap.imports, {
        "aleph/vue": `${alephPkgUri}/framework/vue/mod.ts`,
        "aleph/plugins/vue": `${alephPkgUri}/framework/vue/plugin.ts`,
        "vue": `https://esm.sh/v${ESM_VERSION}/vue@${versions.vue}`,
        "@vue/server-renderer": `https://esm.sh/v${ESM_VERSION}/@vue/server-renderer@${versions.vue}`,
      });
      break;
    }
    case "solid": {
      Object.assign(denoConfig.compilerOptions, {
        "jsx": "react-jsx",
        "jsxImportSource": `https://esm.sh/v${ESM_VERSION}/solid-js@${versions.solid}`,
      });
      Object.assign(importMap.imports, {
        "aleph/plugins/solid": `${alephPkgUri}/framework/solid/plugin.ts`,
        "solid-js": `https://esm.sh/v${ESM_VERSION}/solid-js@${versions.solid}`,
        "solid-js/web": `https://esm.sh/v${ESM_VERSION}/solid-js@${versions.solid}/web`,
        "solid-refresh": `https://esm.sh/v${ESM_VERSION}/solid-refresh@0.5.1`,
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
    cmd: [Deno.execPath(), "cache", "--no-lock", "server.ts"],
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

function getTemplateDisplayName(name: string) {
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
