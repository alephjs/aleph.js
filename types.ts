import type { ServerRequest } from './std.ts';

/**
 * The **ENV** of Aleph.js runtime, you can access it with `window.ALEPH.ENV[key]`.
 */
export interface AlephEnv {
    [key: string]: string
    /** The version of **Aleph.js** */
    readonly __version: string
    /** The build mode of the appliaction (possible values: '**development**' | '**production**') */
    readonly __buildMode: string
    /** The build target of the appliaction (possible values: '**ES2015**' - '**ES2020**' | '**ESNext**') */
    readonly __buildTarget: string
}

/**
 * The options for **SSR**.
 */
export interface SSROptions {
    /** The fallback html **dynamic routes** (default is '**_fallback.html**'). */
    fallback?: string
    /** A list of RegExp for paths to use **SSR**. */
    include?: RegExp[]
    /** A list of RegExp for paths to skip **SSR**. */
    exclude?: RegExp[]
    /** A list of paths for **dynamic routes** in **SSR**. */
    staticPaths?: string[]
}

/**
 * A plugin for **Aleph.js** application.
 */
export interface Plugin {
    test: RegExp
    resolve?(path: string): { path: string, external?: boolean }
    transform?(path: string): { code: string, sourceMap?: string, loader?: 'js' | 'css' | 'text' }
}

/**
 * Config for Aleph.js application.
 */
export interface Config {
    /** `srcDir` to put your application source code (default is '/'). */
    srcDir?: string
    /** `outputDir` specifies the output directory for `build` command (default is '**dist**'). */
    outputDir?: string
    /** `baseUrl` specifies the path prefix for the application (default is '/'). */
    baseUrl?: string
    /** `reactUrl` specifies the **react** download URL (default is 'https://esm.sh/react@16.14.0'). */
    reactUrl?: string
    /** `reactDomUrl` specifies the **react-dom** download URL (default is 'https://esm.sh/react-dom@16.14.0'). */
    reactDomUrl?: string
    /** `defaultLocale` specifies the default locale of the application (default is '**en**'). */
    defaultLocale?: string
    /** A list of locales. */
    locales?: string[]
    /** The options for **SSR**. */
    ssr?: boolean | SSROptions
    /** A list of plugin. */
    plugins?: Plugin[]
    /** A list of plugin of PostCSS. */
    postcss?: { plugins: (string | { name: string, options: Record<string, any> })[] }
    /** `buildTarget` specifies the build target for **tsc** (possible values: '**ES2015**' - '**ES2020**' | '**ESNext**', default is **ES2015** for `production` and **ES2018** for `development`). */
    buildTarget?: string
    /** Enable sourceMap in **production** mode (default is **false**). */
    sourceMap?: boolean
    /** `env` defines the `Window.ALEPH.ENV` object in the application. */
    env?: Record<string, string>
}

/**
 * A handler to handle api requests.
 *
 * @param req APIRequest object
 */
export interface APIHandler {
    (req: APIRequest): void
}

/**
 * The request object from api requests.
 */
export interface APIRequest extends ServerRequest {
    readonly pathname: string
    readonly params: Record<string, string>
    readonly query: URLSearchParams
    readonly cookies: ReadonlyMap<string, string>
    /** `status` sets response status of the request. */
    status(code: number): this
    /** `addHeader` adds a new value onto an existing response header of the request, or
     * adds the header if it does not already exist. */
    addHeader(key: string, value: string): this
    /** `setHeader` sets a new value for an existing response header of the request, or adds
     * the header if it does not already exist. */
    setHeader(key: string, value: string): this
    /** `removeHeader` removes the value for an existing response header of the request.  */
    removeHeader(key: string): this
    /** `send` replies to the request with any content with type */
    send(data: string | Uint8Array | ArrayBuffer, contentType?: string): Promise<void>
    /** `json` replies to the request with a json content */
    json(data: any): Promise<void>
}

/**
 * The Router object of the application routing, you can access it with `useRouter()`.
 */
export interface RouterURL {
    readonly locale: string
    readonly pathname: string
    readonly pagePath: string
    readonly params: Record<string, string>
    readonly query: URLSearchParams
}
