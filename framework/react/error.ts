import { Component, createElement, CSSProperties } from 'https://esm.sh/react'

export class ErrorBoundary extends Component {
  state: { stack: string | null }

  constructor(props: any) {
    super(props)
    this.state = { stack: null }
  }

  static getDerivedStateFromError(error: Error) {
    // Update state so the next render will show the fallback UI.
    return { stack: error?.stack || null }
  }

  componentDidCatch(error: any, errorInfo: any) {
    this.state = { stack: error?.stack || null }
  }

  render() {
    if (this.state.stack) {
      return (
        createElement(
          'pre',
          null,
          this.state.stack
        )
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
      message: `Module "${name}" should export a React Component as default`,
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          width: '100vm',
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

export class AsyncUseDenoError extends Error { }
