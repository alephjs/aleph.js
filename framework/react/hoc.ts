import { ComponentType, createElement } from 'https://esm.sh/react'
import { useDeno, useRouter } from './hooks.ts'

/**
 * `withRouter` allows you to use `useRouter` hook with class component.
 *
 * ```tsx
 * class MyComponent extends React.Component {
 *   render() {
 *     return <p>{this.props.router.pathname}</p>
 *   }
 * }
 * export default withRouter(MyComponent)
 * ```
 */
export function withRouter<P>(Component: ComponentType<P>) {
  return function WithRouter(props: P) {
    const router = useRouter()
    return createElement(Component, { ...props, router })
  }
}

/**
 * `withDeno` allows you to use `useDeno` hook with class component.
 *
 * ```tsx
 * class MyComponent extends React.Component {
 *   render() {
 *     return <p>{this.props.deno.version}</p>
 *   }
 * }
 * export default withDeno(() => ({ version: Deno.version.deno }))(MyComponent)
 * ```
 *
 * @param {Function} callback - hook callback.
 * @param {number} revalidate - revalidate duration in seconds.
 */
export function withDeno<T>(callback: () => (T | Promise<T>), revalidate?: number) {
  return function <P extends T>(Component: ComponentType<P>): ComponentType<Exclude<P, keyof T>> {
    return function WithDeno(props: Exclude<P, keyof T>) {
      const deno = useDeno<T>(callback, revalidate)
      return createElement(Component, { ...props, deno })
    }
  }
}
