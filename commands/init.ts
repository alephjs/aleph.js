import { Untar } from "https://deno.land/std@0.125.0/archive/tar.ts";
import { Buffer } from "https://deno.land/std@0.125.0/io/buffer.ts";
import { copy, readAll } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { blue, cyan, dim, green, red } from "https://deno.land/std@0.125.0/fmt/colors.ts";
import { ensureDir } from "https://deno.land/std@0.125.0/fs/ensure_dir.ts";
import { basename, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { gunzip } from "https://deno.land/x/denoflate@1.2.1/mod.ts";
import { existsDir } from "../lib/fs.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { isCanary, VERSION } from "../version.ts";

const templates = ["react", "vue", "svelte", "vanilla", "api"];
const defaultReactVersion = "17.0.2";

export const helpMessage = `
Usage:
    aleph init <name> [...options]

<name> represents the name of new app.

Options:
    -t, --template [${templates.join(",")}] Specify a template for the created project
    -h, --help      ${" ".repeat(templates.length)}  Prints help message
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
      "aleph/": `${alephPkgUri}/`,
      "aleph/server": `${alephPkgUri}/server/mod.ts`,
    },
    scope: {},
  };
  const denoConfig = {
    "compilerOptions": {
      "lib": [
        "dom",
        "dom.iterable",
        "dom.asynciterable",
        "deno.ns",
      ],
    },
    "format": {},
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
        "react": `https://esm.sh/react@${defaultReactVersion}`,
        "react-dom": `https://esm.sh/react-dom@${defaultReactVersion}`,
        "react-dom/server": `https://esm.sh/react-dom@${defaultReactVersion}/server`,
      });
      Object.assign(denoConfig.compilerOptions, {
        "jsx": "react-jsx",
        "jsxImportSource": `https://esm.sh/react@${defaultReactVersion}`,
      });
    }
  }
  await ensureDir(workingDir);
  await Promise.all([
    Deno.writeTextFile(join(workingDir, ".gitignore"), gitignore.join("\n")),
    Deno.writeTextFile(join(workingDir, "import_map.json"), JSON.stringify(importMap, undefined, 2)),
    Deno.writeTextFile(join(workingDir, "deno.json"), JSON.stringify(denoConfig, undefined, 2)),
  ]);

  if (confirm("Using VS Code?")) {
    const extensions = {
      "recommendations": [
        "denoland.vscode-deno",
      ],
    };
    const settigns = {
      "deno.enable": true,
      "deno.unstable": true,
      "deno.config": "./deno.json",
      "deno.importMap": "./import_map.json",
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

  const msg = `
${green("Aleph.js is ready to go!")}
${dim("▲")} cd ${name}
${dim("▲")} aleph dev    ${dim("# start the app in `development` mode")}
${dim("▲")} aleph start  ${dim("# start the app in `production` mode")}
${dim("▲")} aleph build  ${dim("# build the app to a worker")}

Docs: ${cyan("https://alephjs.org/docs")}
Bugs: ${cyan("https://alephjs.org.com/alephjs/aleph.js/issues")}
`;
  console.log(msg);
  Deno.exit(0);
}

async function isFolderEmpty(root: string, name: string): Promise<boolean> {
  const validFiles = [
    ".DS_Store",
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
    "docs",
    "pages",
    "public",
    "routes",
    "src",
    "app.tsx",
    "deno.json",
    "deno.jsonc",
    "import_map.json",
    "import-map.json",
    "LICENSE",
    "README.md",
    "server.ts",
    "server.tsx",
    "Thumbs.db",
  ];

  const conflicts = [];

  if (await existsDir(join(root, name))) {
    for await (const { name: file, isDirectory } of Deno.readDir(join(root, name))) {
      // Support IntelliJ IDEA-based editors
      if (validFiles.includes(file) || /\.iml$/.test(file)) {
        if (isDirectory) {
          conflicts.push(blue(file) + "/");
        } else {
          conflicts.push(file);
        }
      }
    }
  }

  if (conflicts.length > 0) {
    console.log([
      `The directory ${green(name)} contains files that could conflict:`,
      "",
      ...conflicts.filter((name) => name.endsWith("/")).sort().map((name) => dim("- ") + name),
      ...conflicts.filter((name) => !name.endsWith("/")).sort().map((name) => dim("- ") + name),
      "",
    ].join("\n"));
    return false;
  }

  return true;
}
