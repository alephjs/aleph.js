import {
  createElement,
  ComponentType,
  ComponentPropsWithRef,
  ReactElement,
  useContext,
  useEffect,
  useState
} from 'https://esm.sh/react@17.0.2'
import { FallbackContext } from './context.ts'
import { isLikelyReactComponent } from './helper.ts'
import { useRouter } from './hooks.ts'

/**
 * `withRouter` injects the prop as current `RouterURL` of page routing.
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
 * `dynamic` loads a component asynchronously that is ignored at build time(SSR).
 *
 * ```jsx
 * const MyLogo = dynamic(() => import('~/components/logo.tsx'))
 * export default function Logo() {
 *   return (
 *     <Fallback to={<p>loading...</p>}>
 *       <MyLogo />
 *     </Fallback>
 *   )
 * }
 * ```
 */
export function dynamic<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): ComponentType<ComponentPropsWithRef<T>> {
  const DynamicComponent = (props: ComponentPropsWithRef<T>) => {
    const [mod, setMod] = useState<{ component: T } | null>(null)
    const [err, setErr] = useState<Error | null>(null)
    const { to } = useContext(FallbackContext)

    useEffect(() => {
      factory().then(({ default: component }) => {
        if (isLikelyReactComponent(component, false)) {
          setMod({ component })
        } else {
          setErr(new Error('Missing the component exported as default'))
        }
      }).catch(setErr)
    }, [])

    if (err !== null) {
      return createElement(
        'span',
        {
          style: {
            color: 'red',
            fontWeight: 'bold'
          }
        },
        err.message
      )
    }

    if (mod !== null) {
      return createElement(mod.component, props)
    }

    return to as ReactElement
  }

  return DynamicComponent
}
