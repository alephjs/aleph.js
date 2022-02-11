export type ImportMap = {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
};

export type TransformOptions = {
  alephPkgUri?: string;
  importMap?: ImportMap;
  analyzeJsxStaticClassNames?: boolean;
  jsxRuntime?: "react" | "preact";
  jsxImportSource?: string;
  isDev?: boolean;
  inlineStylePreprocess?(key: string, type: string, tpl: string): Promise<string>;
};

export type InlineStyleExpr = {
  type: string;
  quasis: string[];
  exprs: string[];
};

export type TransformResult = {
  code: string;
  deps?: DependencyDescriptor[];
  jsxStaticClassNames?: string[];
  map?: string;
};

export type DependencyDescriptor = {
  specifier: string;
  isDynamic: boolean;
  isStarExport: boolean;
};

export interface Targets {
  android?: number;
  chrome?: number;
  edge?: number;
  firefox?: number;
  ie?: number;
  ios_saf?: number;
  opera?: number;
  safari?: number;
  samsung?: number;
}

export interface TransformCSSOptions {
  /** Whether to enable minification. */
  minify?: boolean;
  /** Whether to output a source map. */
  sourceMap?: boolean;
  /** The browser targets for the generated code. */
  targets?: Targets;
  /** Whether to enable various draft syntax. */
  drafts?: Drafts;
  /** Whether to compile this file as a CSS module. */
  cssModules?: boolean;
  /**
   * Whether to analyze dependencies (e.g. `@import` and `url()`).
   * When enabled, `@import` rules are removed, and `url()` dependencies
   * are replaced with hashed placeholders that can be replaced with the final
   * urls later (after bundling). Dependencies are returned as part of the result.
   */
  analyzeDependencies?: boolean;
  /**
   * Replaces user action pseudo classes with class names that can be applied from JavaScript.
   * This is useful for polyfills, for example.
   */
  pseudoClasses?: PseudoClasses;
  /**
   * A list of class names, ids, and custom identifiers (e.g. @keyframes) that are known
   * to be unused. These will be removed during minification. Note that these are not
   * selectors but individual names (without any . or # prefixes).
   */
  unusedSymbols?: string[];
}

export interface Drafts {
  /** Whether to enable CSS nesting. */
  nesting?: boolean;
  /** Whether to enable @custom-media rules. */
  customMedia?: boolean;
}

export interface PseudoClasses {
  hover?: string;
  active?: string;
  focus?: string;
  focusVisible?: string;
  focusWithin?: string;
}

export interface TransformCSSResult {
  /** The transformed code. */
  code: string;
  /** The generated source map, if enabled. */
  map?: string;
  /** CSS module exports, if enabled. */
  exports?: CSSModuleExports;
  /** `@import` and `url()` dependencies, if enabled. */
  dependencies?: Dependency[];
}

export type CSSModuleExports = {
  /** Maps exported (i.e. original) names to local names. */
  [name: string]: CSSModuleExport;
};

export interface CSSModuleExport {
  /** The local (compiled) name for this export. */
  name: string;
  /** Whether the export is referenced in this file. */
  isReferenced: boolean;
  /** Other names that are composed by this export. */
  composes: CSSModuleReference[];
}

export type CSSModuleReference = LocalCSSModuleReference | GlobalCSSModuleReference | DependencyCSSModuleReference;

export interface LocalCSSModuleReference {
  type: "local";
  /** The local (compiled) name for the reference. */
  name: string;
}

export interface GlobalCSSModuleReference {
  type: "global";
  /** The referenced global name. */
  name: string;
}

export interface DependencyCSSModuleReference {
  type: "dependency";
  /** The name to reference within the dependency. */
  name: string;
  /** The dependency specifier for the referenced file. */
  specifier: string;
}

export type Dependency = ImportDependency | UrlDependency;

export interface ImportDependency {
  type: "import";
  /** The url of the `@import` dependency. */
  url: string;
  /** The media query for the `@import` rule. */
  media: string | null;
  /** The `supports()` query for the `@import` rule. */
  supports: string | null;
  /** The source location where the `@import` rule was found. */
  loc: SourceLocation;
}

export interface UrlDependency {
  type: "url";
  /** The url of the dependency. */
  url: string;
  /** The source location where the `url()` was found. */
  loc: SourceLocation;
  /** The placeholder that the url was replaced with. */
  placeholder: string;
}

export interface SourceLocation {
  /** The file path in which the dependency exists. */
  filePath: string;
  /** The start location of the dependency. */
  start: Location;
  /** The end location (inclusive) of the dependency. */
  end: Location;
}

export interface Location {
  /** The line number (1-based). */
  line: number;
  /** The column number (0-based). */
  column: number;
}
