import { useDeno } from 'aleph/react'
import React from 'react'
import Logo from '../components/logo.tsx'
import { useCounter, useLocaleText } from '../lib/hooks.ts'

export default function Home() {
  const welcomeText = useLocaleText('Welcome to use', '欢迎使用')
  const websiteText = useLocaleText('Website', '网站')
  const getStartedText = useLocaleText('Get Started', '快速开始')
  const docsText = useLocaleText('Docs', '文档')
  const counterText = useLocaleText('Counter', '计数器')
  const [count, isSyncing, increase, decrease] = useCounter()
  const version = useDeno(() => Deno.version.deno)

  return (
    <div className="page">
      <head>
        <title>Hello World - Aleph.js</title>
        <link rel="stylesheet" href="../style/index.css" />
      </head>
      <p className="logo"><Logo /></p>
      <h1>{welcomeText} <strong>Aleph.js</strong>!</h1>
      <p className="links">
        <a href="https://alephjs.org" target="_blank">{websiteText}</a>
        <span></span>
        <a href="https://alephjs.org/docs/get-started" target="_blank">{getStartedText}</a>
        <span></span>
        <a href="https://alephjs.org/docs" target="_blank">{docsText}</a>
        <span></span>
        <a href="https://github.com/alephjs/aleph.js" target="_blank">Github</a>
      </p>
      <p className="copyinfo">
        <a href="/en"><small>En</small></a>
        <span>/</span>
        <a href="/zh"><small>中</small></a>
      </p>
      <div className="counter">
        <span>{counterText}:</span>
        {isSyncing && (
          <em>...</em>
        )}
        {!isSyncing && (
          <strong>{count}</strong>
        )}
        <button onClick={decrease}>-</button>
        <button onClick={increase}>+</button>
      </div>
      <p className="copyinfo">Built by Aleph.js in Deno {version}</p>
    </div>
  )
}
