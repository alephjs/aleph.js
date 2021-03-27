import {
  createElement,
  ComponentType,
  ExoticComponent,
  Fragment,
  ReactNode,
  useEffect,
  useState
} from 'https://esm.sh/react@17.0.1'
import { useDeno, useRouter } from './hooks.ts'
import util from '../../shared/util.ts'

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
 *     return <p>{this.props.version}</p>
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
      return createElement(Component, { ...props, ...deno })
    }
  }
}

export function dynamic<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): ExoticComponent<T & { fallback?: ReactNode }> {
  const DynamicComponent = ({ fallback, ...props }: T & { fallback?: ReactNode }) => {
    const [Component, setComponent] = useState<T | null>(null)

    useEffect(() => {
      factory().then(mod => {
        setComponent(mod.default)
      })
    }, [])

    if (Component !== null) {
      return createElement(Component, props)
    }

    if (fallback) {
      return createElement(Fragment, null, fallback)
    }

    return null
  }

  DynamicComponent.$$typeof = util.supportSymbolFor ? Symbol.for('react.element') : (0xeac7 as unknown as symbol)

  return DynamicComponent
}
