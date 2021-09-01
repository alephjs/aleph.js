import React from 'react'

export default function Index() {
  return (
    <div className="w-screen h-screen flex items-center justify-center">
      <div className="py-8 px-8 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-6 sm:(py-4 space-y-0 space-x-6)">
        <img className="block mx-auto h-24 rounded-full sm:(mx-0 flex-shrink-0)" src="/logo.svg" alt="Aleph.js" />
        <div className="text-center space-y-2 sm:text-left">
          <div className="space-y-0.1">
            <p className="text-lg text-black font-semibold">Aleph.js</p>
            <p className="text-gray-500 font-medium">CSS Powered by Windi.</p>
          </div>
          <a
            href="https://alephjs.org/docs/get-started"
            className="inline-block px-4 py-1 text-sm text-purple-600 font-semibold rounded-full border border-purple-200 hover:(text-white bg-purple-600 border-transparent) focus:(outline-none ring-2 ring-purple-600 ring-offset-2)"
          >
            Get started
          </a>
        </div>
      </div>
    </div>
  )
}
