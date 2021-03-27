import {
  createElement,
  ComponentType,
  ComponentPropsWithRef,
  ReactChild,
  ReactElement,
  ReactFragment,
  ReactPortal,
  useEffect,
  useState
} from 'https://esm.sh/react'
import { useDeno, useRouter } from './hooks.ts'

type ReactNode = ReactChild | ReactFragment | ReactPortal

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

/**
 * `dynamic` allows you to load a component asynchronously.
 *
 * ```tsx
 * const MyLogo = dynamic(() => import('~/components/logo.tsx'))
 * export default function Logo() {
 *   return <MyLogo fallback={<p>loading...</p>}/>
 * }
 * ```
 *
 * @param {Function} factory - load factory.
 */
export function dynamic<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): ComponentType<ComponentPropsWithRef<T> & { fallback?: ReactNode }> {
  const DynamicComponent = ({ fallback, ...props }: ComponentPropsWithRef<T> & { fallback?: ReactNode }) => {
    const [mod, setMod] = useState<{ default: T } | null>(null)

    useEffect(() => {
      factory().then(setMod)
    }, [])

    if (mod !== null) {
      return createElement(mod.default, props)
    }

    if (fallback) {
      return fallback as unknown as ReactElement
    }

    return null
  }

  return DynamicComponent
}
