'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function CallbackContent() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const code = searchParams.get('code')
        const error = searchParams.get('error')
        const state = searchParams.get('state')

        if (error) {
          setStatus('error')
          setMessage(`OAuth error: ${error}`)
          return
        }

        if (!code) {
          setStatus('error')
          setMessage('No authorization code received')
          return
        }

        console.log('Processing OAuth callback with code:', code)

        // Send the authorization code to our backend to exchange for tokens
        const response = await fetch('http://localhost:8080/procore/oauth/callback', {
          method: 'GET',
          credentials: 'include', // Include cookies for session
          headers: {
            'Content-Type': 'application/json',
          },
        })

        // Construct URL with query parameters since FastAPI expects query params
        const callbackUrl = new URL('http://localhost:8080/procore/oauth/callback')
        callbackUrl.searchParams.set('code', code)
        if (state) callbackUrl.searchParams.set('state', state)

        const callbackResponse = await fetch(callbackUrl.toString(), {
          credentials: 'include',
        })

        if (callbackResponse.ok) {
          const result = await callbackResponse.json()
          console.log('OAuth callback successful:', result)
          
          setStatus('success')
          setMessage('Successfully authenticated with Procore! You can now export RFIs.')
          
          // Close the popup window after a short delay
          setTimeout(() => {
            window.close()
          }, 2000)
        } else {
          const error = await callbackResponse.json()
          console.error('OAuth callback failed:', error)
          setStatus('error')
          setMessage(`Authentication failed: ${error.detail || 'Unknown error'}`)
        }

      } catch (error) {
        console.error('Error processing OAuth callback:', error)
        setStatus('error')
        setMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    handleCallback()
  }, [searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6">
        <div className="text-center">
          {status === 'loading' && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Authenticating with Procore
              </h2>
              <p className="text-gray-600">
                Please wait while we complete your authentication...
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="rounded-full w-12 h-12 bg-green-100 mx-auto mb-4 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-green-900 mb-2">
                Authentication Successful!
              </h2>
              <p className="text-green-700">
                {message}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                This window will close automatically...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="rounded-full w-12 h-12 bg-red-100 mx-auto mb-4 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-red-900 mb-2">
                Authentication Failed
              </h2>
              <p className="text-red-700 text-sm">
                {message}
              </p>
              <button 
                onClick={() => window.close()} 
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Close Window
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProcoreCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}