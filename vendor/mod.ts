export { Document } from './deno-dom/document.ts'
export { default as less } from './less/less.js'
import './clean-css-builds/v4.2.2.js'

const { CleanCSS } = window as any
export const cleanCSS = new CleanCSS({ compatibility: '*' /* Internet Explorer 10+ */ })
