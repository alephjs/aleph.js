import React from 'https://esm.sh/react'

export function ErrorPage({ status, text = getStatusText(status) }: { status: number, text?: string }) {
    return React.createElement(
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
