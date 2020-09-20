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

export const E501 = {
    App: () => e501AppEl,
    Page: () => e501PageEl
}

export function E404Page() {
    return e404PageEl
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
                    status + ' Error - Aleph.js'
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
