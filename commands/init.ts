import { Untar } from "https://deno.land/std@0.145.0/archive/tar.ts";
import { Buffer } from "https://deno.land/std@0.145.0/io/buffer.ts";
import { copy, readAll } from "https://deno.land/std@0.145.0/streams/conversion.ts";
import { blue, cyan, dim, green, red } from "https://deno.land/std@0.145.0/fmt/colors.ts";
import { ensureDir } from "https://deno.land/std@0.145.0/fs/ensure_dir.ts";
import { basename, dirname, join } from "https://deno.land/std@0.145.0/path/mod.ts";
import { gunzip } from "https://deno.land/x/denoflate@1.2.1/mod.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { generateRoutesModule } from "../server/dev.ts";
import { existsDir } from "../server/helpers.ts";
import { initRoutes } from "../server/routing.ts";
import { isCanary } from "../version.ts";

type TemplateMeta = {
  entry: string;
  cli?: boolean;
  unocss?: boolean;
};

const templates: Record<string, TemplateMeta> = {
  "api": { entry: "server.ts" },
  "react": { entry: "server.tsx", unocss: true },
  "vue": { entry: "server.ts", cli: true, unocss: true },
  "yew": { entry: "server.ts", cli: true },
  // todo:
  // "preact",
  // "svelte",
  // "lit",
  // "vanilla",
};

const versions = {
  react: "18.1.0",
  vue: "3.2.33",
};
const deployCI = `name: Deploy
on: [push]

jobs:
  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    permissions:
      id-token: write # Needed for auth with Deno Deploy
      contents: read # Needed to clone the repository

    steps:
      - name: Clone repository
        uses: actions/checkout@v2

      - name: Install Deno
        uses: denoland/setup-deno@v1

      - name: Build App
        run: deno task build

      - name: Deploy to Deno Deploy
        uses: denoland/deployctl@v1
        with:
          project: PROJECT_NAME # todo: change this to your project name in https://dash.deno.com
          entrypoint: dist/server.js
`;

export const helpMessage = `
Usage:
    deno run -A https://deno.land/x/aleph/cli.ts init <name> [...options]

<name> represents the name of new app.

Options:
    -t, --template [${Object.keys(templates).join(",")}] Specify a template for the created project
    -h, --help      ${" ".repeat(Object.keys(templates).join(",").length)}  Prints help message
`;

export default async function init(nameArg?: string, template?: string) {
  if (!template) {
    // todo: template choose dialog
    template = "react";
  }
  if (!(template in templates)) {
    log.fatal(`Invalid template name ${red(template)}, must be one of [${blue(Object.keys(templates).join(","))}]`);
  }

  // get and check the project name
  const name = nameArg || (prompt("Project Name:") || "").trim();
  if (name === "") {
    await init(nameArg, template);
    return;
  }
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
    log.fatal(`Invalid project name: ${red(name)}`);
  }

  // check the dir is clean
  if (!(await isFolderEmpty(Deno.cwd(), name)) && !confirm("Continue?")) {
    Deno.exit(1);
  }

  // download template
  console.log("Downloading template, this might take a moment...");
  const pkgName = isCanary ? "aleph_canary" : "aleph";
  const res = await fetch(`https://cdn.deno.land/${pkgName}/meta/versions.json`);
  if (res.status !== 200) {
    console.error(await res.text());
    Deno.exit(1);
  }
  const { latest: VERSION } = await res.json();
  const repo = isCanary ? "ije/aleph-canary" : "alephjs/aleph.js";
  const resp = await fetch(`https://codeload.github.com/${repo}/tar.gz/refs/tags/${VERSION}`);
  if (resp.status !== 200) {
    console.error(await resp.text());
    Deno.exit(1);
  }
  const gzData = await readAll(new Buffer(await resp.arrayBuffer()));
  const tarData = gunzip(gzData);
  const entryList = new Untar(new Buffer(tarData));
  const workingDir = join(Deno.cwd(), name);

  // write template files
  for await (const entry of entryList) {
    const prefix = `${basename(repo)}-${VERSION}/examples/${template}-app/`;
    if (entry.fileName.startsWith(prefix)) {
      const name = util.trimPrefix(entry.fileName, prefix);
      if (name !== "README.md") {
        const fp = join(workingDir, name);
        if (entry.type === "directory") {
          await ensureDir(fp);
          continue;
        }
        const file = await Deno.open(fp, { write: true, create: true });
        await copy(entry, file);
      }
    }
  }

  const { entry, cli: cliMode, unocss } = templates[template];

  // generate `routes.gen.ts` module
  if (!cliMode) {
    const entryCode = await Deno.readTextFile(join(workingDir, entry));
    const m = entryCode.match(/(\s+)routes: "(.+)"/);
    if (m) {
      const routeConfig = await initRoutes(m[2], undefined, workingDir);
      await Deno.writeTextFile(
        join(workingDir, entry),
        entryCode
          .replace(/(\s+)routes: "(.+)/, `$1routes: "$2$1routeModules,`)
          .replace(
            /(\s*)serve\({/,
            `$1// pre-import route modules for serverless env that doesn't support the dynamic imports.\nimport routeModules from "${routeConfig.prefix}/_export.ts";\n\nserve({`,
          ),
      );
      await generateRoutesModule(routeConfig, workingDir);
    }
  }

  const alephPkgUri = `https://deno.land/x/${pkgName}@${VERSION}`;
  const importMap = {
    imports: {
      "~/": "./",
      "std/": "https://deno.land/std@0.145.0/",
      "aleph/": `${alephPkgUri}/`,
      "aleph/server": `${alephPkgUri}/server/mod.ts`,
    },
    scopes: {},
  };
  const denoConfig = {
    "compilerOptions": {
      "lib": [
        "dom",
        "dom.iterable",
        "dom.asynciterable",
        "dom.extras",
        "deno.ns",
      ],
      "types": [
        `${alephPkgUri}/types.d.ts`,
      ],
    },
    "importMap": "import_map.json",
    "tasks": cliMode
      ? {
        "dev": `deno run -A ${alephPkgUri}/cli.ts dev`,
        "start": `deno run -A ${alephPkgUri}/cli.ts start`,
        "build": `deno run -A ${alephPkgUri}/cli.ts build`,
      }
      : {
        "dev": `ALEPH_ENV=development deno run -A ${entry}`,
        "start": `deno run -A ${entry}`,
      },
    "fmt": {},
    "lint": {},
  };
  const gitignore = [];
  if (cliMode) {
    gitignore.push("dist/");
  }
  switch (template) {
    case "react": {
      Object.assign(importMap.imports, {
        "aleph/react": `${alephPkgUri}/framework/react/mod.ts`,
        "react": `https://esm.sh/react@${versions.react}`,
        "react-dom": `https://esm.sh/react-dom@${versions.react}`,
        "react-dom/": `https://esm.sh/react-dom@${versions.react}/`,
      });
      Object.assign(denoConfig.compilerOptions, {
        "jsx": "react-jsx",
        "jsxImportSource": `https://esm.sh/react@${versions.react}`,
      });
      break;
    }
    case "vue": {
      Object.assign(importMap.imports, {
        "aleph/vue": `${alephPkgUri}/framework/vue/mod.ts`,
        "vue": `https://esm.sh/vue@${versions.vue}`,
        "vue/server-renderer": `https://esm.sh/@vue/server-renderer@${versions.vue}`,
        "*.vue": `${alephPkgUri}/loaders/vue.ts!loader`,
      });
      break;
    }
  }

  if (unocss && confirm("Enable UnoCSS(atomic CSS)?")) {
    Object.assign(importMap.imports, {
      "@unocss/": `${alephPkgUri}/lib/@unocss/`,
    });
    const entryCode = await Deno.readTextFile(join(workingDir, entry));
    await Deno.writeTextFile(
      join(workingDir, entry),
      `import presetUno from "@unocss/preset-uno.ts";\n` + entryCode.replace(
        /(\s+)ssr: {/,
        [
          `$1unocss: {`,
          `    // Options for UnoCSS (atomic CSS)`,
          `    // please check https://alephjs.org/docs/unocss `,
          `    presets: [`,
          `      presetUno(),`,
          `    ],`,
          `    theme: {},`,
          `  },`,
          `  ssr: {`,
        ].join("\n"),
      ),
    );
  }

  await ensureDir(workingDir);
  await Promise.all([
    gitignore.length > 0 ? Deno.writeTextFile(join(workingDir, ".gitignore"), gitignore.join("\n")) : Promise.resolve(),
    Deno.writeTextFile(join(workingDir, "deno.json"), JSON.stringify(denoConfig, undefined, 2)),
    Deno.writeTextFile(join(workingDir, "import_map.json"), JSON.stringify(importMap, undefined, 2)),
  ]);

  if (cliMode && confirm("Deploy to Deno Deploy?")) {
    const ciFile = join(workingDir, ".github/workflows/deploy.yml");
    await ensureDir(dirname(ciFile));
    await Deno.writeTextFile(ciFile, deployCI);
    console.log(`${blue(".github/workflows/deploy.yml")} created, pelase update the project name in deploy.yml.`);
  }

  // todo: remove this step when deno-vsc support auto enable mode
  if (confirm("Using VS Code?")) {
    const extensions = {
      "recommendations": [
        "denoland.vscode-deno",
      ],
    };
    const settigns = {
      "deno.enable": true,
      "deno.lint": true,
      "deno.config": "./deno.json",
    };
    await ensureDir(join(workingDir, ".vscode"));
    await Promise.all([
      Deno.writeTextFile(
        join(workingDir, ".vscode", "extensions.json"),
        JSON.stringify(extensions, undefined, 2),
      ),
      Deno.writeTextFile(
        join(workingDir, ".vscode", "settings.json"),
        JSON.stringify(settigns, undefined, 2),
      ),
    ]);
  }

  console.log(
    [
      " ",
      green("Aleph.js is ready to go!"),
      `${dim("▲")} cd ${name}`,
      `${dim("▲")} deno task dev    ${dim("# start the app in `development` mode")}`,
      `${dim("▲")} deno task start  ${dim("# start the app in `production` mode")}`,
      cliMode &&
      `${dim("▲")} deno task build  ${dim("# build & optimize the app for serverless platform")}`,
      " ",
      `Docs: ${cyan("https://alephjs.org/docs")}`,
      `Bugs: ${cyan("https://alephjs.org.com/alephjs/aleph.js/issues")}`,
      " ",
    ].filter(Boolean).join("\n"),
  );
  Deno.exit(0);
}

if (import.meta.main) {
  init();
}

async function isFolderEmpty(root: string, name: string): Promise<boolean> {
  const validFiles = [
    ".git",
    ".gitattributes",
    ".gitignore",
    ".gitlab-ci.yml",
    ".github",
    ".hg",
    ".hgcheck",
    ".hgignore",
    ".idea",
    ".travis.yml",
    "assets",
    "components",
    "docs",
    "lib",
    "pages",
    "public",
    "routes",
    "src",
    "style",
    "test",
    "tests",
    "utils",
    "app.*",
    "deno.json",
    "deno.jsonc",
    "import_map.json",
    "import-map.json",
    "LICENSE",
    "main.*",
    "mod.*",
    "README.md",
    "server.*",
    "tsconfig.json",
  ];

  const conflictDirs = [];
  const conflictFiles = [];

  if (await existsDir(join(root, name))) {
    for await (const { name: file, isDirectory } of Deno.readDir(join(root, name))) {
      if (
        validFiles.includes(file) ||
        validFiles.some((name) => name.endsWith(".*") && file.startsWith(name.slice(0, -2))) ||
        // Support IntelliJ IDEA-based editors
        /\.iml$/.test(file)
      ) {
        if (isDirectory) {
          conflictDirs.push(blue(file) + "/");
        } else {
          conflictFiles.push(file);
        }
      }
    }
  }

  if (conflictFiles.length > 0 || conflictDirs.length > 0) {
    console.log([
      `The directory ${green(name)} contains files that could conflict:`,
      "",
      ...conflictFiles.filter((name) => name.endsWith("/")).sort().map((name) => dim("- ") + name),
      ...conflictFiles.sort().map((name) => dim("- ") + name),
      "",
    ].join("\n"));
    return false;
  }

  return true;
}
