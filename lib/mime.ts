// MIME Types for Web
const mimeTypes: Record<string, string[]> = {
  // application
  "application/javascript": ["js", "mjs"],
  "application/typescript": ["ts", "mts", "cts"],
  "application/node": ["cjs"],
  "application/wasm": ["wasm"],
  "application/json": ["json", "jsonc", "map"],
  "application/json5": ["json5"],
  "application/pdf": ["pdf"],
  "application/xml": ["xml", "xsl"],
  "application/zip": ["zip"],
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
  "text/yaml": ["yaml"],
  "text/plain": ["txt", "text", "conf", "ini", "log", "glsl"],
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

// map types
const typesMap = Object.entries(mimeTypes).reduce((map, [contentType, exts]) => {
  exts.forEach((ext) => map.set(ext, contentType));
  return map;
}, new Map<string, string>());

/** get content type by file name */
export function getContentType(filename: string, charset?: string): string {
  const ext = filename.split(".").pop()!.toLowerCase();
  let ctype = typesMap.get(ext);
  if (charset) {
    ctype = `${ctype}; charset=${charset}`;
  }
  return ctype ?? "application/octet-stream";
}
