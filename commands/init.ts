import { Untar } from "https://deno.land/std@0.125.0/archive/tar.ts";
import { Buffer } from "https://deno.land/std@0.125.0/io/buffer.ts";
import { copy, readAll } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { blue, cyan, dim, green, red } from "https://deno.land/std@0.125.0/fmt/colors.ts";
import { ensureDir } from "https://deno.land/std@0.125.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { gunzip } from "https://deno.land/x/denoflate@1.2.1/mod.ts";
import { existsDir } from "../lib/fs.ts";
import util from "../lib/util.ts";
import { VERSION } from "../version.ts";

const defaultReactVersion = "17.0.2";

export const helpMessage = `
Usage:
    aleph init <name> [...options]

<name> represents the name of new app.

Options:
    -t, --template [react,vue,svelte,vanilla,api] Specify a template for the created project
    -h, --help                                Prints help message
`;

export default async function (nameArg: string | undefined, template = "react") {
  const cwd = Deno.cwd();
  const rev = "master";

  const name = nameArg || (prompt("Project Name:") || "").trim();
  if (name === "") {
    return;
  }

  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
    console.error(`Invalid project name: ${red(name)}`);
    return;
  }

  // check dir is clean
  if (!await isFolderEmpty(cwd, name)) {
    if (!confirm("Continue?")) {
      Deno.exit(1);
    }
  }

  // download template
  console.log("Downloading template. This might take a moment...");
  const resp = await fetch(
    "https://codeload.github.com/alephjs/aleph.js/tar.gz/" + rev,
  );
  const gzData = await readAll(new Buffer(await resp.arrayBuffer()));

  console.log("Apply template...");
  const tarData = gunzip(gzData);
  const entryList = new Untar(new Buffer(tarData));

  for await (const entry of entryList) {
    if (
      entry.fileName.startsWith(`aleph.js-${rev}/examples/hello-${template}/`)
    ) {
      const fp = join(
        cwd,
        name,
        util.trimPrefix(
          entry.fileName,
          `aleph.js-${rev}/examples/hello-${template}/`,
        ),
      );
      if (entry.type === "directory") {
        await ensureDir(fp);
        continue;
      }
      const file = await Deno.open(fp, { write: true, create: true });
      await copy(entry, file);
    }
  }

  const gitignore = [
    ".DS_Store",
    "Thumbs.db",
    ".aleph/",
    "dist/",
  ];
  const importMap = {
    imports: {
      "~/": "./",
      "std/": "https://deno.land/std@0.125.0/",
      "aleph/": `https://deno.land/x/aleph@v${VERSION}/`,
      "aleph/server": `https://deno.land/x/aleph@v${VERSION}/server/mod.ts`,
      "aleph/react": `https://deno.land/x/aleph@v${VERSION}/framework/react/mod.ts`,
      "react": `https://esm.sh/react@${defaultReactVersion}`,
      "react-dom": `https://esm.sh/react-dom@${defaultReactVersion}`,
      "react-dom/server": `https://esm.sh/react-dom@${defaultReactVersion}/server`,
    },
  };
  const denoConfig = {
    "compilerOptions": {
      "lib": [
        "dom",
        "dom.iterable",
        "dom.asynciterable",
        "deno.ns",
      ],
      "jsx": "react-jsx",
      "jsxImportSource": `https://esm.sh/react@${defaultReactVersion}`,
    },
    "format": {},
    "lint": {},
  };
  await Promise.all([
    Deno.writeTextFile(join(cwd, name, ".gitignore"), gitignore.join("\n")),
    Deno.writeTextFile(
      join(cwd, name, "import_map.json"),
      JSON.stringify(importMap, undefined, 2),
    ),
    Deno.writeTextFile(
      join(cwd, name, "deno.json"),
      JSON.stringify(denoConfig, undefined, 2),
    ),
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
    };
    await ensureDir(join(name, ".vscode"));
    await Promise.all([
      Deno.writeTextFile(
        join(name, ".vscode", "extensions.json"),
        JSON.stringify(extensions, undefined, 2),
      ),
      Deno.writeTextFile(
        join(name, ".vscode", "settings.json"),
        JSON.stringify(settigns, undefined, 2),
      ),
    ]);
  }

  const msg = `
${green("Aleph.js is ready to go!")}
${dim("▲")} cd ${name}
${dim("▲")} aleph dev    ${dim("# start the app in `development` mode")}
${dim("▲")} aleph start  ${dim("# start the app in `production` mode")}
${dim("▲")} aleph build  ${dim("# build the app to a static site (SSG)")}

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
    ".hg",
    ".hgcheck",
    ".hgignore",
    ".idea",
    ".travis.yml",
    "LICENSE",
    "Thumbs.db",
    "docs",
    "public",
    "api",
    "pages",
    "src",
    "app.tsx",
    "aleph.config.ts",
    "import_map.json",
    "mkdocs.yml",
  ];

  const conflicts = [];

  if (await existsDir(join(root, name))) {
    for await (
      const { name: file, isDirectory } of Deno.readDir(join(root, name))
    ) {
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
    console.log(
      [
        `The directory ${green(name)} contains files that could conflict:`,
        "",
        ...conflicts.filter((name) => name.endsWith("/")).sort().map((name) => dim("- ") + name),
        ...conflicts.filter((name) => !name.endsWith("/")).sort().map((name) => dim("- ") + name),
        "",
      ].join("\n"),
    );
    return false;
  }

  return true;
}
