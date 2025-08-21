// Simple tooltip fallback component
import React, { ReactNode } from 'react'

export interface TooltipProps {
  children: ReactNode
}

export interface TooltipTriggerProps {
  asChild?: boolean
  children: ReactNode
}

export interface TooltipContentProps {
  children: ReactNode
}

export function TooltipProvider({ children }: TooltipProps) {
  return <>{children}</>
}

export function Tooltip({ children }: TooltipProps) {
  return <>{children}</>
}

export function TooltipTrigger({ children }: TooltipTriggerProps) {
  return <>{children}</>
}

export function TooltipContent({ children }: TooltipContentProps) {
  return (
    <div 
      className="absolute z-50 bg-gray-900 text-white text-xs p-2 rounded shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
      style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)' }}
    >
      {children}
    </div>
  )
}
