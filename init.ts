import { Untar } from "https://deno.land/std@0.145.0/archive/tar.ts";
import { parse } from "https://deno.land/std@0.145.0/flags/mod.ts";
import { blue, cyan, dim, green, red } from "https://deno.land/std@0.145.0/fmt/colors.ts";
import { ensureDir } from "https://deno.land/std@0.145.0/fs/ensure_dir.ts";
import { Buffer } from "https://deno.land/std@0.145.0/io/buffer.ts";
import { basename, join } from "https://deno.land/std@0.145.0/path/mod.ts";
import { copy, readAll } from "https://deno.land/std@0.145.0/streams/conversion.ts";
import { gunzip } from "https://deno.land/x/denoflate@1.2.1/mod.ts";
import log from "./lib/log.ts";
import util from "./lib/util.ts";
import { type GenerateOptions, generateRoutesExportModule } from "./server/dev.ts";
import { existsDir, existsFile, getFiles } from "./server/helpers.ts";
import { initRoutes } from "./server/routing.ts";
import { isCanary } from "./version.ts";

type TemplateMeta = {
  entry: string;
  unocss?: boolean;
};

const templates: Record<string, TemplateMeta> = {
  "api": { entry: "server.ts" },
  "react": { entry: "server.tsx" },
  "vue": { entry: "server.ts" },
  "yew": { entry: "server.ts" },
  // todo:
  // "preact",
  // "svelte",
  // "lit",
  // "vanilla",
};

const versions = {
  react: "18.1.0",
  vue: "3.2.37",
};

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
  if (!(await isFolderEmpty(Deno.cwd(), name)) && !confirm(`Folder ${blue(name)} already exists, continue?`)) {
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
  const appDir = join(Deno.cwd(), name);
  const { entry, unocss } = templates[template];
  const uno = unocss && confirm("Enable UnoCSS (Atomic CSS)?");

  // write template files
  for await (const entry of entryList) {
    const prefix = `${basename(repo)}-${VERSION}/examples/${template}-app${uno ? "-unocss" : ""}/`;
    if (entry.fileName.startsWith(prefix)) {
      const name = util.trimPrefix(entry.fileName, prefix);
      if (name !== "README.md") {
        const fp = join(appDir, name);
        if (entry.type === "directory") {
          await ensureDir(fp);
          continue;
        }
        const file = await Deno.open(fp, { write: true, create: true });
        await copy(entry, file);
      }
    }
  }

  // generate `routes/_export.ts` module
  const entryCode = await Deno.readTextFile(join(appDir, entry));
  const m = entryCode.match(/(\s+)routes: "(.+)"/);
  if (m) {
    const routeConfig = await initRoutes(m[2], appDir);
    await Deno.writeTextFile(
      join(appDir, entry),
      entryCode
        .replace(
          /(\s*)serve\({/,
          `$1// pre-import route modules for serverless env that doesn't support the dynamic imports.\nimport routeModules from "${routeConfig.prefix}/_export.ts";\n\nserve({`,
        )
        .replace(/(\s+)routes: "(.+)/, `$1routes: "$2$1routeModules,`),
    );
    const genOptions: GenerateOptions = { routeConfig };
    if (template === "vue") {
      const { default: VueLoader } = await import("./loaders/vue.ts");
      genOptions.loaders = [new VueLoader()];
    }
    await generateRoutesExportModule(genOptions);
  }

  const alephPkgUri = `https://deno.land/x/${pkgName}@${VERSION}`;
  const importMap = {
    imports: {
      "~/": "./",
      "std/": "https://deno.land/std@0.145.0/",
      "aleph/": `${alephPkgUri}/`,
      "aleph/server": `${alephPkgUri}/server/mod.ts`,
      "aleph/dev": `${alephPkgUri}/server/dev.ts`,
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
    "tasks": {
      "dev": `deno run -A -q dev.ts`,
      "start": `deno run -A ${entry}`,
    },
    "fmt": {},
    "lint": {},
  };
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
      });
      break;
    }
  }

  await ensureDir(appDir);
  await Promise.all([
    Deno.writeTextFile(join(appDir, "deno.json"), JSON.stringify(denoConfig, undefined, 2)),
    Deno.writeTextFile(join(appDir, "import_map.json"), JSON.stringify(importMap, undefined, 2)),
  ]);

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
    await ensureDir(join(appDir, ".vscode"));
    await Promise.all([
      Deno.writeTextFile(
        join(appDir, ".vscode", "extensions.json"),
        JSON.stringify(extensions, undefined, 2),
      ),
      Deno.writeTextFile(
        join(appDir, ".vscode", "settings.json"),
        JSON.stringify(settigns, undefined, 2),
      ),
    ]);
  }

  console.log([
    "",
    green("Aleph.js is ready to go!"),
    `${dim("$")} cd ${name}`,
    `${dim("$")} deno task dev    ${dim("# start the app in `development` mode")}`,
    `${dim("$")} deno task start  ${dim("# start the app in `production` mode")}`,
    "",
    `Docs: ${cyan("https://alephjs.org/docs")}`,
    `Bugs: ${cyan("https://alephjs.org.com/alephjs/aleph.js/issues")}`,
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
    const files = await getFiles(dir);
    return files.length === 0 || files.every((file) => [".DS_Store"].includes(file));
  }
  return false;
}

if (import.meta.main) {
  const { _: args, ...options } = parse(Deno.args);
  await init(args[0], options?.template);
}
