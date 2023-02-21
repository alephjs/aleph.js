import { splitBy, trimPrefix } from "../shared/util.ts";

// MIME types for web
const mimeTypes: Record<string, string[]> = {
  // application
  "application/javascript": ["js", "mjs"],
  "application/typescript": ["ts", "mts"],
  "application/wasm": ["wasm"],
  "application/json": ["json", "jsonc", "map"],
  "application/json5": ["json5"],
  "application/pdf": ["pdf"],
  "application/xml": ["xml", "plist", "tmLanguage", "tmTheme"],
  "application/zip": ["zip"],
  "application/gzip": ["gz"],
  "application/tar": ["tar"],
  "application/tar+gzip": ["tar.gz", "tgz"],
  // text
  "text/html": ["html", "htm"],
  "text/markdown": ["md", "markdown"],
  "text/mdx": ["mdx"],
  "text/jsx": ["jsx"],
  "text/tsx": ["tsx"],
  "text/vue": ["vue"],
  "text/svelte": ["svelte"],
  "text/css": ["css"],
  "text/postcss": ["pcss", "postcss"],
  "text/less": ["less"],
  "text/sass": ["sass", "scss"],
  "text/stylus": ["stylus", "styl"],
  "text/csv": ["csv"],
  "text/yaml": ["yaml", "yml"],
  "text/plain": ["txt", "glsl"],
  // font
  "font/ttf": ["ttf"],
  "font/otf": ["otf"],
  "font/woff": ["woff"],
  "font/woff2": ["woff2"],
  "font/collection": ["ttc"],
  // image
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/apng": ["apng"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "image/avif": ["avif"],
  "image/svg+xml": ["svg", "svgz"],
  "image/x-icon": ["ico"],
  // audio
  "audio/mp4": ["m4a"],
  "audio/mpeg": ["mp3", "m3a"],
  "audio/ogg": ["ogg", "oga"],
  "audio/wav": ["wav"],
  "audio/webm": ["weba"],
  // video
  "video/mp4": ["mp4", "m4v"],
  "video/ogg": ["ogv"],
  "video/webm": ["webm"],
  "video/x-matroska": ["mkv"],
  // shader
  "x-shader/x-fragment": ["frag"],
  "x-shader/x-vertex": ["vert"],
};

const typesMap = Object.entries(mimeTypes).reduce((map, [contentType, exts]) => {
  exts.forEach((ext) => map.set(ext, contentType));
  return map;
}, new Map<string, string>());

/** register a new type */
export function registerType(ext: string, contentType: string) {
  typesMap.set(trimPrefix(ext, "."), contentType);
}

/** get the content type by file name */
export function getContentType(filename: string): string {
  let [prefix, ext] = splitBy(filename, ".", true);
  if (ext === "gz" && prefix.endsWith(".tar")) {
    ext = "tar.gz";
  }
  return typesMap.get(ext) ?? "application/octet-stream";
}
