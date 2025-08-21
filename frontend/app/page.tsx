"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

export default function Dashboard() {
  const router = useRouter()
  const [redirecting, setRedirecting] = useState(true)
  
  useEffect(() => {
    const redirect = async () => {
      try {
        await router.push('/projects')
      } catch (error) {
        console.error('Redirect error:', error)
        setRedirecting(false)
      }
    }
    
    // Add a small delay to ensure proper mounting
    const timeout = setTimeout(redirect, 100)
    
    return () => clearTimeout(timeout)
  }, [router])
  
  if (!redirecting) {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <p>Unable to redirect automatically.</p>
        <button 
          onClick={() => router.push('/projects')}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Go to Projects Dashboard
        </button>
      </div>
    )
  }
  
  return (
    <div className="flex items-center justify-center h-screen">
      <p>Redirecting to Projects Dashboard...</p>
    </div>
  )
}
