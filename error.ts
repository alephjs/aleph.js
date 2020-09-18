import React from 'https://esm.sh/react'

export const errAppEl = React.createElement(ErrorPage, { status: 500, text: 'app module should export default as a react component', refreshButton: true })
export const errPageEl = React.createElement(ErrorPage, { status: 500, text: 'page module should export default as a react component', refreshButton: true })

export function ErrorPage({ status, text = getStatusText(status), refreshButton }: { status: number, text?: string, refreshButton?: boolean }) {
    return [
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
    ]
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
