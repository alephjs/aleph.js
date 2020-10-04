import React from 'https://esm.sh/react'
import Head from './head.ts'

const e501AppEl = React.createElement(
    ErrorPage,
    {
        status: 501,
        text: 'app module should export default as a react component',
        refreshButton: true
    }
)
const e501PageEl = React.createElement(
    ErrorPage,
    {
        status: 501,
        text: 'page module should export default as a react component',
        refreshButton: true
    }
)
const e404PageEl = React.createElement(ErrorPage, { status: 404 })

export const E501App = () => e501AppEl
export const E501Page = () => e501PageEl
export const E404Page = () => e404PageEl

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

export function ErrorPage({ status, text = getStatusText(status), refreshButton }: { status: number, text?: string, refreshButton?: boolean }) {
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
                    status + ' - ' + text
                ),
            ),
            React.createElement(
                'p',
                null,
                React.createElement(
                    'strong',
                    null,
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
                    text
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

function getStatusText(status: number) {
    switch (status) {
        case 404:
            return 'page not found'
        case 500:
            return 'internal server error'
        default:
            return 'error'
    }
}
