import { Component, createElement, Fragment } from 'https://esm.sh/react'

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

export function E400MissingDefaultExportAsComponent({ name }: { name: string }) {
    return createElement(
        StatusError,
        {
            status: 400,
            message: `Module "${name}" should export a React Component as default`,
            showRefreshButton: true
        }
    )
}

export function StatusError({ status, message, showRefreshButton }: { status: number, message: string, showRefreshButton?: boolean }) {
    return (
        createElement(
            Fragment,
            null,
            createElement(
                'p',
                null,
                createElement(
                    'strong',
                    null,
                    createElement(
                        'code',
                        null,
                        status
                    )
                ),
                createElement(
                    'small',
                    null,
                    ' - '
                ),
                createElement(
                    'span',
                    null,
                    message
                )
            ),
            showRefreshButton && createElement(
                'p',
                null,
                createElement(
                    'button',
                    {
                        onClick() {
                            const { location } = window as any
                            location.reload()
                        }
                    },
                    'Refresh'
                )
            )
        )
    )
}

export class AsyncUseDenoError extends Error { }
