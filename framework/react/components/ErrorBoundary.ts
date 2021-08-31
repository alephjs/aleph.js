import { Component, createElement, CSSProperties } from 'https://esm.sh/react@17.0.2'
import { inDeno } from '../helper.ts'

export class ErrorBoundary extends Component<{}, { error: Error | Promise<any> | null }> {
  constructor(props: {}) {
    super(props)
    this.state = { error: null }
    if (!inDeno) {
      Object.assign(window, { __ALEPH_ErrorBoundary: this })
    }
  }

  componentDidCatch(error: any, info: any) {
    this.setState({ error })
    if (error instanceof Promise) {
      error.then(() => this.setState({ error: null })).catch(error => this.setState({ error }))
      return
    }
    const event = new CustomEvent('componentDidCatch', { detail: { error, info } })
    window.dispatchEvent(event)
  }

  render() {
    const { error } = this.state

    // todo: default loading UI
    if (error instanceof Promise) {
      return null
    }

    // todo: error UI
    if (error instanceof Error) {
      return createElement(
        'pre',
        null,
        error.stack || error.message || error.toString()
      )
    }

    return this.props.children
  }
}

export function E404Page() {
  return createElement(
    StatusError,
    {
      status: 404,
      message: 'Page Not Found'
    }
  )
}

export function E400MissingComponent({ name }: { name: string }) {
  return createElement(
    StatusError,
    {
      status: 400,
      message: `Module '${name}' should export a React Component as default`,
      showRefreshButton: true
    }
  )
}

const resetStyle: CSSProperties = {
  padding: 0,
  margin: 0,
  lineHeight: 1.5,
  fontSize: 15,
  fontWeight: 400,
  color: '#333',
}

export function StatusError({ status, message }: { status: number, message: string }) {
  return (
    createElement(
      'div',
      {
        style: {
          ...resetStyle,
          position: 'fixed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          width: '100vw',
          height: '100vh',
        }
      },
      createElement(
        'p',
        {
          style: {
            ...resetStyle,
            fontWeight: 500,
          }
        },
        createElement(
          'code',
          {
            style: {
              ...resetStyle,
              fontWeight: 700,
            }
          },
          status
        ),
        createElement(
          'small',
          {
            style: {
              ...resetStyle,
              fontSize: 14,
              color: '#999'
            }
          },
          ' - '
        ),
        createElement(
          'span',
          null,
          message
        )
      )
    )
  )
}
