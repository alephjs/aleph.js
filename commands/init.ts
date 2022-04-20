import { Untar } from "https://deno.land/std@0.135.0/archive/tar.ts";
import { Buffer } from "https://deno.land/std@0.135.0/io/buffer.ts";
import { copy, readAll } from "https://deno.land/std@0.135.0/streams/conversion.ts";
import { blue, cyan, dim, green, red } from "https://deno.land/std@0.135.0/fmt/colors.ts";
import { ensureDir } from "https://deno.land/std@0.135.0/fs/ensure_dir.ts";
import { basename, join } from "https://deno.land/std@0.135.0/path/mod.ts";
import { gunzip } from "https://deno.land/x/denoflate@1.2.1/mod.ts";
import { existsDir } from "../lib/fs.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { isCanary, VERSION } from "../version.ts";

const templates = ["react", "preact", "vue", "svelte", "lit", "vanilla", "api"];
const versions = {
  react: "17.0.2",
  vue: "3.2.31",
};

export const helpMessage = `
Usage:
    deno run -A https://deno.land/x/aleph/cli.ts init <name> [...options]

<name> represents the name of new app.

Options:
    -t, --template [${templates.join(",")}] Specify a template for the created project
    -h, --help      ${" ".repeat(templates.join(",").length)}  Prints help message
`;

export default async function (nameArg: string | undefined, template = "react") {
  if (!templates.includes(template)) {
    log.fatal(`Invalid template ${red(template)}, must be one of ${templates.join(",")}`);
  }

  const name = nameArg || (prompt("Project Name:") || "").trim();
  if (name === "") {
    return;
  }

  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
    log.fatal(`Invalid project name: ${red(name)}`);
  }

  // check dir is clean
  if (!await isFolderEmpty(Deno.cwd(), name)) {
    if (!confirm("Continue?")) {
      Deno.exit(1);
    }
  }

  // download template
  console.log("Downloading template, this might take a moment...");
  const repo = isCanary ? "ije/aleph-canary" : "alephjs/aleph.js";
  const resp = await fetch(`https://codeload.github.com/${repo}/tar.gz/refs/tags/${VERSION}`);
  const gzData = await readAll(new Buffer(await resp.arrayBuffer()));
  const tarData = gunzip(gzData);
  const entryList = new Untar(new Buffer(tarData));
  const workingDir = join(Deno.cwd(), name);

  for await (const entry of entryList) {
    const prefix = `${basename(repo)}-${VERSION}/examples/${template}-app/`;
    if (entry.fileName.startsWith(prefix)) {
      const fp = join(workingDir, util.trimPrefix(entry.fileName, prefix));
      if (entry.type === "directory") {
        await ensureDir(fp);
        continue;
      }
      const file = await Deno.open(fp, { write: true, create: true });
      await copy(entry, file);
    }
  }

  const pkgName = isCanary ? "aleph_canary" : "aleph";
  const alephPkgUri = `https://deno.land/x/${pkgName}@${VERSION}`;
  const importMap = {
    imports: {
      "~/": "./",
      "@unocss/": `${alephPkgUri}/lib/@unocss/`,
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
        "deno.ns",
      ],
      "types": [
        `${alephPkgUri}/types.d.ts`,
      ],
    },
    "importMap": "import_map.json",
    "tasks": {
      "dev": `deno run -A ${alephPkgUri}/cli.ts dev`,
      "start": `deno run -A ${alephPkgUri}/cli.ts start`,
      "build": `deno run -A ${alephPkgUri}/cli.ts build`,
    },
    "fmt": {},
    "lint": {},
  };
  const gitignore = [
    ".DS_Store",
    "Thumbs.db",
    "dist/",
  ];
  switch (template) {
    case "react": {
      Object.assign(importMap.imports, {
        "aleph/react": `${alephPkgUri}/framework/react/mod.ts`,
        "react": `https://esm.sh/react@${versions.react}`,
        "react-dom": `https://esm.sh/react-dom@${versions.react}`,
        "react-dom/server": `https://esm.sh/react-dom@${versions.react}/server`,
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
  await ensureDir(workingDir);
  await Promise.all([
    Deno.writeTextFile(join(workingDir, ".gitignore"), gitignore.join("\n")),
    Deno.writeTextFile(join(workingDir, "deno.json"), JSON.stringify(denoConfig, undefined, 2)),
    Deno.writeTextFile(join(workingDir, "import_map.json"), JSON.stringify(importMap, undefined, 2)),
  ]);

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
      "deno.suggest.imports.hosts": {
        "https://deno.land": true,
        "https://esm.sh": false,
      },
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

  console.log([
    "",
    green("Aleph.js is ready to go!"),
    `${dim("▲")} cd ${name}`,
    `${dim("▲")} deno task dev    ${dim("# start the app in `development` mode")}`,
    `${dim("▲")} deno task start  ${dim("# start the app in `production` mode")}`,
    `${dim("▲")} deno task build  ${dim("# build the app into a worker for serverless platforms like Deno Deploy")}`,
    "",
    `Docs: ${cyan("https://alephjs.org/docs")}`,
    `Bugs: ${cyan("https://alephjs.org.com/alephjs/aleph.js/issues")}`,
    "",
  ].join("\n"));
  Deno.exit(0);
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
    "app.tsx",
    "deno.json",
    "deno.jsonc",
    "import_map.json",
    "import-map.json",
    "LICENSE",
    "main.js",
    "main.jsx",
    "main.ts",
    "main.tsx",
    "README.md",
    "server.js",
    "server.jsx",
    "server.ts",
    "server.tsx",
    "tsconfig.json",
  ];

  const conflictDirs = [];
  const conflictFiles = [];

  if (await existsDir(join(root, name))) {
    for await (const { name: file, isDirectory } of Deno.readDir(join(root, name))) {
      // Support IntelliJ IDEA-based editors
      if (validFiles.includes(file) || /\.iml$/.test(file)) {
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
