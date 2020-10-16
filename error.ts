import React from 'https://esm.sh/react'
import { Head } from './head.ts'

export class ErrorBoundary extends React.Component {
    state: { stack: string | null }

    constructor(props: any) {
        super(props)
        this.state = { stack: null }
    }

    static getDerivedStateFromError(error: Error) {
        // Update state so the next render will show the fallback UI.
        return { stack: error.stack }
    }

    componentDidCatch(error: any, errorInfo: any) {
        this.state = { stack: error.stack }
    }

    render() {
        if (this.state.stack) {
            return (
                React.createElement(
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
    return React.createElement(
        Error,
        {
            status: 404,
            message: 'page not found'
        }
    )
}

export function E400MissingDefaultExportAsComponent({ name }: { name: string }) {
    return React.createElement(
        Error,
        {
            status: 400,
            message: `"${name}" should export a React Component as default`,
            refreshButton: true
        }
    )
}

export function Error({ status, message, refreshButton }: { status: number, message: string, refreshButton?: boolean }) {
    return (
        React.createElement(
            React.Fragment,
            null,
            React.createElement(
                Head,
                null,
                React.createElement(
                    'title',
                    null,
                    `Error ${status} - ${message} | Aleph.js`
                ),
            ),
            React.createElement(
                'p',
                null,
                React.createElement(
                    'strong',
                    null,
                    'Error ',
                    React.createElement(
                        'code',
                        null,
                        status
                    )
                ),
                React.createElement(
                    'small',
                    null,
                    ' - '
                ),
                React.createElement(
                    'span',
                    null,
                    message
                )
            ),
            refreshButton && React.createElement(
                'p',
                null,
                React.createElement(
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
