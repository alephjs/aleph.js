import { useRouter } from 'aleph'
import React from 'react'

export default function Name() {
    const { params } = useRouter()

    return (
        <div className="page name-page">
            <head>
                <title>Hi, {params.name}!</title>
                <link rel="stylesheet" href="../../style/name.css" />
            </head>
            <h1>Hi, <strong>{params.name}</strong>!</h1>
            <p className="go-button">
                <a href="/"><button>Back</button></a>
            </p>
        </div>
    )
}
