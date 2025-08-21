"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams } from "next/navigation"
import { useSidebar } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Send, MessageCircle, Bot, User, FileText, X, Home, ChevronRight, Plus, Loader2, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { MultiTabSVGViewer } from "@/components/multi-tab-svg-viewer"

// Type definitions
interface Sheet {
  id: number;
  code: string;
  title: string;
  type: string;
  page: number;
  status: 'not started' | 'in progress' | 'completed';
  documentId: number;
  svgContent?: string;
}

interface Project {
  id: number;
  name: string;
  date: string;
}

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  sheetReference?: {
    id: number;
    code: string;
    title: string;
  };
}

export default function ChatbotPage() {
  const params = useParams()
  const projectId = params.id as string
  const { setOpenMobile, setOpen } = useSidebar()

  const [project, setProject] = useState<Project | null>(null)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isTyping, setIsTyping] = useState(false)
  const [streamingMessage, setStreamingMessage] = useState<string>("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [thinkingDots, setThinkingDots] = useState("")
  const [toolStatus, setToolStatus] = useState<string>("")
  const [isExecutingTool, setIsExecutingTool] = useState(false)
  const [openSheets, setOpenSheets] = useState<Sheet[]>([])
  const [selectedSheet, setSelectedSheet] = useState<Sheet | null>(null)
  const [activeSheetId, setActiveSheetId] = useState<number | null>(null)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sheetColumns, setSheetColumns] = useState<Record<number, any[]>>({})
  const [sheetGridLines, setSheetGridLines] = useState<Record<number, any[]>>({})
  const [sheetMeasurementLines, setSheetMeasurementLines] = useState<Record<number, any[]>>({})
  const [sheetWalls, setSheetWalls] = useState<Record<number, any[]>>({})
  const [sheetNonStructuralWalls, setSheetNonStructuralWalls] = useState<Record<number, any[]>>({})
  const [sheetElevations, setSheetElevations] = useState<Record<number, any[]>>({})
  const [currentZoomAction, setCurrentZoomAction] = useState<{sheetId: number, center_x: number, center_y: number, zoom_level: number, timestamp: number} | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Close sidebar on page load
  useEffect(() => {
    setOpen(false)
    setOpenMobile(false)
  }, [setOpen, setOpenMobile])

  // Create a new chatbot session
  const createSession = async () => {
    try {
      const response = await fetch(`http://localhost:8080/api/chatbot/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: parseInt(projectId)
        })
      })

      const data = await response.json()
      if (data.success) {
        setSessionId(data.sessionId)
        console.log('✅ New session created:', data.sessionId)
        return data.sessionId
      } else {
        console.error('❌ Failed to create session:', data.error)
        return null
      }
    } catch (error) {
      console.error('❌ Error creating session:', error)
      return null
    }
  }

  // Fetch project and sheets data + create session
  useEffect(() => {
    const fetchProjectData = async () => {
      try {
        setIsLoading(true)
        
        // Fetch project details
        const projectResponse = await fetch(`/api/projects/${projectId}`)
        if (!projectResponse.ok) {
          throw new Error('Failed to fetch project')
        }
        const projectData = await projectResponse.json()
        setProject(projectData)

        // Fetch sheets for this project
        const sheetsResponse = await fetch(`/api/sheets?projectId=${projectId}`)
        if (!sheetsResponse.ok) {
          throw new Error('Failed to fetch sheets')
        }
        const sheetsData = await sheetsResponse.json()
        setSheets(sheetsData.sheets || [])

        // Create a new session
        const newSessionId = await createSession()
        if (!newSessionId) {
          throw new Error('Failed to create session')
        }

        // Add welcome message
        const welcomeMessage: Message = {
          id: 'welcome',
          content: `Welcome to the ${projectData.name} AI Assistant! I can help you navigate and work with construction drawing sheets. Try asking me to "open sheet A2.31" or "show me slab drawings for hotel".`,
          sender: 'bot',
          timestamp: new Date()
        }
        setMessages([welcomeMessage])

      } catch (err) {
        console.error('Error fetching project data:', err)
        const errorMessage: Message = {
          id: 'error',
          content: 'Sorry, I encountered an error loading the project data. Please try again later.',
          sender: 'bot',
          timestamp: new Date()
        }
        setMessages([errorMessage])
      } finally {
        setIsLoading(false)
      }
    }

    if (projectId) {
      fetchProjectData()
    }
  }, [projectId])

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Scroll during streaming
  useEffect(() => {
    if (isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [streamingMessage, isStreaming])

  // Animate thinking dots
  useEffect(() => {
    if (isTyping) {
      const dotsPattern = ["", ".", "..", "..."]
      let currentIndex = 0
      
      const interval = setInterval(() => {
        setThinkingDots(dotsPattern[currentIndex])
        currentIndex = (currentIndex + 1) % dotsPattern.length
      }, 500)
      
      return () => clearInterval(interval)
    } else {
      setThinkingDots("")
    }
  }, [isTyping])

  // Process chatbot messages through backend with streaming updates
  const processMessageStream = async (userMessage: string, onUpdate: (update: any) => void) => {
    if (!sessionId) {
      console.error('❌ No session ID available')
      return 'Session not initialized. Please refresh the page.'
    }

    try {
      console.log('🚀 Starting streaming request to backend...')
      const response = await fetch(`http://localhost:8080/api/chatbot/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          sessionId: sessionId,
          context: {
            openSheets: openSheets.map(sheet => ({
              id: sheet.id,
              code: sheet.code,
              title: sheet.title,
              type: sheet.type
            })),
            currentSheet: selectedSheet ? {
              id: selectedSheet.id,
              code: selectedSheet.code,
              title: selectedSheet.title,
              type: selectedSheet.type
            } : null
          }
        })
      })

      if (!response.ok) {
        console.error(`❌ Streaming request failed: ${response.status} ${response.statusText}`)
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      console.log('✅ Streaming response received, starting to read...')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response body reader available')
      }

      let finalResponse = 'I can help you with construction documents and sheets.'
      
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')
          
          for (const line of lines) {
            console.log('📦 Raw streaming line:', line)
            if (line.trim() && line.startsWith('data: ')) {
              try {
                const jsonString = line.slice(6).trim()
                
                // Check for obvious JSON issues before parsing
                if (!jsonString || jsonString === '' || jsonString === '{}') {
                  console.log('🟡 Skipping empty JSON data')
                  continue
                }
                
                const data = JSON.parse(jsonString)
                console.log('📡 Parsed streaming update:', data)
                
                // Call the update handler
                onUpdate(data)
                
                // Handle different update types
                if (data.type === 'action') {
                  // Process action immediately
                  await processActionImmediate(data.action)
                } else if (data.type === 'final') {
                  finalResponse = data.response
                } else if (data.type === 'error') {
                  finalResponse = data.response
                }
              } catch (parseError) {
                console.error('❌ Failed to parse streaming JSON:', parseError)
                console.error('❌ Problematic line length:', line.length)
                console.error('❌ Line preview:', line.substring(0, 200) + (line.length > 200 ? '...' : ''))
                
                // Check if it's a large payload issue
                if (line.length > 100000) {
                  console.error('💥 Very large JSON payload detected - this may be the root cause')
                  console.error('💡 Consider reducing the size of non-structural wall data on the backend')
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      return finalResponse
    } catch (error) {
      console.error('❌ Error in streaming message processing:', error)
      throw error // Don't fall back, show the error so we can debug
    }
  }

  // Process chatbot messages through backend (fallback)
  const processMessage = async (userMessage: string) => {
    if (!sessionId) {
      console.error('❌ No session ID available')
      return 'Session not initialized. Please refresh the page.'
    }

    try {
      const response = await fetch(`http://localhost:8080/api/chatbot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          sessionId: sessionId,
          context: {
            openSheets: openSheets.map(sheet => ({
              id: sheet.id,
              code: sheet.code,
              title: sheet.title,
              type: sheet.type
            })),
            currentSheet: selectedSheet ? {
              id: selectedSheet.id,
              code: selectedSheet.code,
              title: selectedSheet.title,
              type: selectedSheet.type
            } : null
          }
        })
      })

      const data = await response.json()
      
      if (data.success) {
        // Handle any actions returned from the agent
        if (data.actions && data.actions.length > 0) {
          console.log('📋 Received actions from backend:', data.actions)
          
          // Track which sheet should be active after all actions
          let targetSheetId: number | null = null
          
          console.log('🎯 Processing actions batch:', data.actions?.length || 0)
          for (const action of data.actions) {
            console.log('🔍 Processing action:', action.action, 'Full action:', action)
            if (action.action === 'show_columns' && action.sheet && action.columns) {
              // Handle show columns action - open sheet and add column overlays
              console.log('📍 Showing columns for sheet:', action.sheet, 'columns:', action.columns)
              
              const sheet = action.sheet
              const columns = action.columns
              
              const newSheet: Sheet = {
                id: sheet.id,
                code: sheet.code,
                title: sheet.title,
                type: sheet.type,
                page: sheet.page || 1,
                status: sheet.status || 'not started',
                documentId: sheet.documentId || 0,
                svgContent: ''  // Will be loaded separately
              }
              
              // Check if sheet is already open
              const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
              
              if (!isAlreadyOpen) {
                // Fetch SVG content and add sheet to tabs
                fetchSheetSvgAndAddTab(sheet.id, newSheet)
              }
              
              setSelectedSheet(newSheet)
              targetSheetId = sheet.id // Track for setting active after all actions
              
              // Store column data for display
              setSheetColumns(prev => ({
                ...prev,
                [sheet.id]: columns
              }))
              
              console.log('Column positions to display:', columns.map((col: any) => ({
                center: `(${col.center_x}, ${col.center_y})`,
                size: `${col.width}x${col.height}`
              })))
              
            } else if (action.action === 'show_grid_lines' && action.sheet && action.grid_lines) {
              // Handle show grid lines action - open sheet and add grid line overlays
              console.log('📍 Showing grid lines for sheet:', action.sheet, 'grid_lines:', action.grid_lines)
              
              const sheet = action.sheet
              const grid_lines = action.grid_lines
              
              const newSheet: Sheet = {
                id: sheet.id,
                code: sheet.code,
                title: sheet.title,
                type: sheet.type,
                page: sheet.page || 1,
                status: sheet.status || 'not started',
                documentId: sheet.documentId || 0,
                svgContent: ''  // Will be loaded separately
              }
              
              // Check if sheet is already open
              const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
              
              if (!isAlreadyOpen) {
                // Fetch SVG content and add sheet to tabs
                fetchSheetSvgAndAddTab(sheet.id, newSheet)
              }
              
              setSelectedSheet(newSheet)
              targetSheetId = sheet.id // Track for setting active after all actions
              
              // Store grid line data for display
              setSheetGridLines(prev => ({
                ...prev,
                [sheet.id]: grid_lines
              }))
              
              console.log('Grid line positions to display:', grid_lines.map((gl: any) => ({
                label: gl.label,
                category: gl.category,
                orientation: gl.orientation,
                center: `(${gl.center_x}, ${gl.center_y})`
              })))
              
            } else if (action.action === 'show_measurements' && action.sheet && action.distance_lines) {
              // Handle show measurements action - open sheet and add measurement line overlays
              console.log('📏 Showing measurements for sheet:', action.sheet, 'distance_lines:', action.distance_lines)
              
              const sheet = action.sheet
              const distance_lines = action.distance_lines
              
              const newSheet: Sheet = {
                id: sheet.id,
                code: sheet.code,
                title: sheet.title,
                type: sheet.type,
                page: sheet.page || 1,
                status: sheet.status || 'not started',
                documentId: sheet.documentId || 0,
                svgContent: ''  // Will be loaded separately
              }
              
              // Check if sheet is already open
              const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
              
              if (!isAlreadyOpen) {
                // Fetch SVG content and add sheet to tabs
                fetchSheetSvgAndAddTab(sheet.id, newSheet)
              }
              
              setSelectedSheet(newSheet)
              targetSheetId = sheet.id // Track for setting active after all actions
              
              // Store measurement line data for display
              setSheetMeasurementLines(prev => ({
                ...prev,
                [sheet.id]: distance_lines
              }))
              
              console.log('Measurement lines to display:', distance_lines.map((line: any) => ({
                text: line.distance_text,
                length: line.length_inches,
                from: `(${line.start_x}, ${line.start_y})`,
                to: `(${line.end_x}, ${line.end_y})`
              })))
              
            } else if (action.action === 'zoom_to_location' && action.sheet && action.zoom_action) {
              // Handle zoom to location action
              console.log('🔍 Zoom action for sheet:', action.sheet, 'zoom:', action.zoom_action)
              
              const sheet = action.sheet
              const zoom = action.zoom_action
              
              // Create new zoom action with timestamp
              const zoomAction = {
                sheetId: sheet.id,
                center_x: zoom.center_x,
                center_y: zoom.center_y,
                zoom_level: zoom.zoom_level,
                timestamp: Date.now()
              }
              
              setCurrentZoomAction(zoomAction)
              
              // Also ensure the sheet is open and set as active
              const newSheet: Sheet = {
                id: sheet.id,
                code: sheet.code,
                title: sheet.title,
                type: sheet.type,
                page: sheet.page || 1,
                status: sheet.status || 'completed',
                documentId: sheet.documentId || 0,
                svgContent: ''
              }
              
              const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
              if (!isAlreadyOpen) {
                // Fetch SVG content and add sheet to tabs
                fetchSheetSvgAndAddTab(sheet.id, newSheet)
              }
              
              // Set the sheet as selected and active
              setSelectedSheet(newSheet)
              targetSheetId = sheet.id
              
            } else if (action.action === 'open_sheet' && action.sheet) {
              // Open the sheet in the viewer
              const sheet = action.sheet
              console.log('📄 Opening sheet:', sheet)
              
              const newSheet: Sheet = {
                id: sheet.id,
                code: sheet.code,
                title: sheet.title,
                type: sheet.type,
                page: sheet.page,
                status: sheet.status,
                documentId: sheet.documentId,
                svgContent: sheet.svgContent || ''
              }
              
              // Check if sheet is already open
              const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
              
              if (!isAlreadyOpen) {
                if (sheet.svgContent) {
                  console.log('✅ Adding sheet with SVG content to tabs:', sheet.code)
                  setOpenSheets(prev => {
                    // Double-check if sheet already exists (race condition protection)
                    const exists = prev.find(s => s.id === newSheet.id)
                    if (exists) {
                      console.log('ℹ️ Sheet already exists, updating with SVG content')
                      return prev.map(s => s.id === newSheet.id ? newSheet : s)
                    }
                    return [...prev, newSheet]
                  })
                } else {
                  console.log('⚠️ No SVG content available for sheet', sheet.code)
                  // Try to fetch SVG content separately and add to tabs
                  fetchSheetSvgAndAddTab(sheet.id, newSheet)
                }
              } else {
                console.log('ℹ️ Sheet already open in tabs:', sheet.code)
              }
              
              setSelectedSheet(newSheet)
              targetSheetId = sheet.id // Track for setting active after all actions
              
            } else if (action.action === 'highlight_elevations' && action.sheet && action.elevations) {
              // Handle highlight elevations action - open sheet and add elevation overlays
              console.log('🏗️ Highlighting elevations for sheet:', action.sheet, 'elevations:', action.elevations)
              
              const sheet = action.sheet
              const elevations = action.elevations
              
              const newSheet: Sheet = {
                id: sheet.id,
                code: sheet.code,
                title: sheet.title,
                type: sheet.type,
                page: sheet.page || 1,
                status: sheet.status || 'not started',
                documentId: sheet.documentId || 0,
                svgContent: ''  // Will be loaded separately
              }
              
              // Check if sheet is already open
              const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
              
              if (!isAlreadyOpen) {
                // Fetch SVG content and add sheet to tabs
                fetchSheetSvgAndAddTab(sheet.id, newSheet)
              }
              
              setSelectedSheet(newSheet)
              targetSheetId = sheet.id // Track for setting active after all actions
              
              // Store elevation data for display
              setSheetElevations(prev => ({
                ...prev,
                [sheet.id]: elevations
              }))
              
              console.log('Elevation positions to display:', elevations.map((elev: any) => ({
                id: elev.id,
                text: elev.text,
                bbox: elev.bbox,
                color: elev.color
              })))
              
            } else if (action.action === 'mark_non_structural_walls' && action.sheet && action.walls) {
              // Handle mark non-structural walls action - use overlay pattern like columns/walls
              console.log('🔶 MARK NON-STRUCTURAL WALLS ACTION RECEIVED!')
              console.log('🔶 Marking non-structural walls for sheet:', action.sheet)
              console.log('🔶 Wall elements count:', action.walls.length)
              console.log('🔶 Sample walls:', action.walls.slice(0, 3))
              
              // Debug: check wall element structure and sheet ID
              console.log('🔍 Action sheet ID vs current state:', {
                actionSheetId: action.sheet?.id,
                actionSheetCode: action.sheet?.code,
                currentSheetId: selectedSheet?.id,
                currentSheetCode: selectedSheet?.code
              })
              
              if (action.walls.length > 0) {
                const firstWall = action.walls[0]
                console.log('🔍 First wall structure:', {
                  type: firstWall.type,
                  x: firstWall.x,
                  y: firstWall.y, 
                  width: firstWall.width,
                  height: firstWall.height,
                  center_x: firstWall.center_x,
                  center_y: firstWall.center_y
                })
              }
              
              const sheet = action.sheet
              const walls = action.walls
              const wallColor = action.wall_color || 'orange'
              
              // Create sheet object
              const newSheet: Sheet = {
                id: sheet.id,
                code: sheet.code,
                title: sheet.title,
                type: sheet.type,
                page: sheet.page || 1,
                status: sheet.status || 'completed',
                documentId: sheet.documentId || 0,
                svgContent: '' // Will be loaded separately
              }
              
              // Check if sheet is already open
              const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
              
              if (!isAlreadyOpen) {
                // Fetch SVG content and add sheet to tabs
                fetchSheetSvgAndAddTab(sheet.id, newSheet)
              }
              
              setSelectedSheet(newSheet)
              targetSheetId = sheet.id // Track for setting active after all actions
              
              // Store non-structural wall overlay data (same pattern as columns)
              setSheetNonStructuralWalls(prev => ({
                ...prev,
                [sheet.id]: walls.map((wall: any) => ({
                  ...wall,
                  color: wallColor,
                  highlighted: true
                }))
              }))
              
              console.log('✅ Added non-structural wall overlays for sheet:', sheet.code)
            }
          }
          
          // Set active sheet after all actions are processed
          if (targetSheetId) {
            setActiveSheetId(targetSheetId)
          }
        } else {
          console.log('ℹ️ No actions received from backend')
        }
        
        return data.response
      } else {
        return data.response || 'I encountered an error processing your request.'
      }
    } catch (error) {
      console.error('Error communicating with chatbot:', error)
      return 'I\'m sorry, I\'m having trouble connecting to the AI assistant. Please try again later.'
    }
  }

  // Process actions immediately when they arrive via streaming
  const processActionImmediate = async (action: any) => {
    console.log('🚀 Processing immediate action:', action)
    
    if (action.action === 'show_columns' && action.sheet && action.columns) {
      // Handle show columns action - open sheet and add column overlays
      console.log('📍 Immediate columns for sheet:', action.sheet, 'columns:', action.columns)
      
      const sheet = action.sheet
      const columns = action.columns
      
      const newSheet: Sheet = {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        type: sheet.type,
        page: sheet.page || 1,
        status: sheet.status || 'not started',
        documentId: sheet.documentId || 0,
        svgContent: ''
      }
      
      // Check if sheet is already open
      const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
      
      if (!isAlreadyOpen) {
        // Fetch SVG content and add sheet to tabs
        fetchSheetSvgAndAddTab(sheet.id, newSheet)
      }
      
      setSelectedSheet(newSheet)
      setActiveSheetId(sheet.id)
      
      // Store column data for display
      setSheetColumns(prev => ({
        ...prev,
        [sheet.id]: columns
      }))
      
    } else if (action.action === 'show_grid_lines' && action.sheet && action.grid_lines) {
      // Handle show grid lines action - open sheet and add grid line overlays
      console.log('📍 Immediate grid lines for sheet:', action.sheet, 'grid_lines:', action.grid_lines)
      
      const sheet = action.sheet
      const grid_lines = action.grid_lines
      
      const newSheet: Sheet = {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        type: sheet.type,
        page: sheet.page || 1,
        status: sheet.status || 'not started',
        documentId: sheet.documentId || 0,
        svgContent: ''
      }
      
      // Check if sheet is already open
      const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
      
      if (!isAlreadyOpen) {
        // Fetch SVG content and add sheet to tabs
        fetchSheetSvgAndAddTab(sheet.id, newSheet)
      }
      
      setSelectedSheet(newSheet)
      setActiveSheetId(sheet.id)
      
      // Store grid line data for display
      setSheetGridLines(prev => ({
        ...prev,
        [sheet.id]: grid_lines
      }))
      
    } else if (action.action === 'highlight_columns' && action.sheet && action.columns) {
      // Handle highlight columns action - open sheet and add highlighted column overlays
      console.log('🎯 Highlighting columns for sheet:', action.sheet, 'columns:', action.columns)
      
      const sheet = action.sheet
      const columns = action.columns
      
      const newSheet: Sheet = {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        type: sheet.type,
        page: sheet.page,
        status: sheet.status,
        documentId: sheet.documentId,
        svgContent: '' // Will be fetched separately
      }
      
      // Check if sheet is already open
      const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
      
      if (!isAlreadyOpen) {
        console.log('🔄 Fetching SVG content separately for highlighted sheet:', sheet.code)
        // Always fetch SVG content separately to avoid chunking issues
        fetchSheetSvgAndAddTab(sheet.id, newSheet)
      } else {
        console.log('ℹ️ Sheet already open, just highlighting columns:', sheet.code)
      }
      
      setSelectedSheet(newSheet)
      setActiveSheetId(sheet.id)
      
      // Store highlighted column data for display with special highlighting
      setSheetColumns(prev => ({
        ...prev,
        [sheet.id]: columns.map((col: any) => ({
          ...col,
          highlighted: true,
          highlightColor: col.color || '#ff6b6b'
        }))
      }))
      
    } else if (action.action === 'highlight_walls' && action.sheet && action.walls) {
      // Handle highlight walls action - open sheet and add highlighted wall overlays
      console.log('🧱 Highlighting walls for sheet:', action.sheet, 'walls:', action.walls)
      
      const sheet = action.sheet
      const walls = action.walls
      
      const newSheet: Sheet = {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        type: sheet.type,
        page: sheet.page,
        status: sheet.status,
        documentId: sheet.documentId,
        svgContent: '' // Will be fetched separately
      }
      
      // Check if sheet is already open
      const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
      
      if (!isAlreadyOpen) {
        console.log('🔄 Fetching SVG content separately for highlighted wall sheet:', sheet.code)
        // Always fetch SVG content separately to avoid chunking issues
        fetchSheetSvgAndAddTab(sheet.id, newSheet)
      } else {
        console.log('ℹ️ Sheet already open, just highlighting walls:', sheet.code)
      }
      
      setSelectedSheet(newSheet)
      setActiveSheetId(sheet.id)
      
      // Store highlighted wall data for display with special highlighting
      setSheetWalls(prev => ({
        ...prev,
        [sheet.id]: walls.map((wall: any) => ({
          ...wall,
          highlighted: true,
          highlightColor: wall.color || '#FF9800' // Default orange color for walls
        }))
      }))
      
    } else if (action.action === 'highlight_elevations' && action.sheet && action.elevations) {
      // Handle highlight elevations action - open sheet and add elevation overlays
      console.log('🏗️ Immediate highlighting elevations for sheet:', action.sheet, 'elevations:', action.elevations)
      
      const sheet = action.sheet
      const elevations = action.elevations
      
      const newSheet: Sheet = {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        type: sheet.type,
        page: sheet.page,
        status: sheet.status,
        documentId: sheet.documentId,
        svgContent: '' // Will be fetched separately
      }
      
      // Check if sheet is already open
      const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
      
      if (!isAlreadyOpen) {
        console.log('🔄 Fetching SVG content separately for elevation sheet:', sheet.code)
        // Always fetch SVG content separately to avoid chunking issues
        fetchSheetSvgAndAddTab(sheet.id, newSheet)
      } else {
        console.log('ℹ️ Sheet already open, just highlighting elevations:', sheet.code)
      }
      
      setSelectedSheet(newSheet)
      setActiveSheetId(sheet.id)
      
      // Store elevation data for display
      setSheetElevations(prev => ({
        ...prev,
        [sheet.id]: elevations
      }))
      
      console.log('Immediate elevation positions to display:', elevations.map((elev: any) => ({
        id: elev.id,
        text: elev.text,
        bbox: elev.bbox,
        color: elev.color
      })))
      
    } else if (action.action === 'show_measurements' && action.sheet && action.distance_lines) {
      // Handle show measurements action immediately - open sheet and add measurement line overlays
      console.log('📏 Immediate measurements for sheet:', action.sheet, 'distance_lines:', action.distance_lines)
      
      const sheet = action.sheet
      const distance_lines = action.distance_lines
      
      const newSheet: Sheet = {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        type: sheet.type,
        page: sheet.page || 1,
        status: sheet.status || 'not started',
        documentId: sheet.documentId || 0,
        svgContent: ''
      }
      
      // Check if sheet is already open
      const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
      
      if (!isAlreadyOpen) {
        // Fetch SVG content and add sheet to tabs
        fetchSheetSvgAndAddTab(sheet.id, newSheet)
      }
      
      setSelectedSheet(newSheet)
      setActiveSheetId(sheet.id)
      
      // Store measurement line data for display
      setSheetMeasurementLines(prev => ({
        ...prev,
        [sheet.id]: distance_lines
      }))
      
      console.log('Immediate measurement lines to display:', distance_lines.map((line: any) => ({
        text: line.distance_text,
        length: line.length_inches,
        from: `(${line.start_x}, ${line.start_y})`,
        to: `(${line.end_x}, ${line.end_y})`
      })))
      
    } else if (action.action === 'zoom_to_location' && action.sheet && action.zoom_action) {
      // Handle zoom to location action immediately
      console.log('🔍 Immediate zoom action for sheet:', action.sheet, 'zoom:', action.zoom_action)
      
      const sheet = action.sheet
      const zoom = action.zoom_action
      
      // Create new zoom action with timestamp
      const zoomAction = {
        sheetId: sheet.id,
        center_x: zoom.center_x,
        center_y: zoom.center_y,
        zoom_level: zoom.zoom_level,
        timestamp: Date.now()
      }
      
      setCurrentZoomAction(zoomAction)
      
      // Also ensure the sheet is open
      const newSheet: Sheet = {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        type: sheet.type,
        page: sheet.page || 1,
        status: sheet.status || 'not started',
        documentId: sheet.documentId || 0,
        svgContent: ''
      }
      
      const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
      if (!isAlreadyOpen) {
        // Fetch SVG content and add sheet to tabs
        fetchSheetSvgAndAddTab(sheet.id, newSheet)
      }
      
      // Set the sheet as selected and active
      setSelectedSheet(newSheet)
      setActiveSheetId(sheet.id)
      
    } else if (action.action === 'open_sheet' && action.sheet) {
      // Open the sheet in the viewer immediately
      const sheet = action.sheet
      console.log('📄 Immediate sheet open:', sheet.code)
      
      const newSheet: Sheet = {
        id: sheet.id,
        code: sheet.code,
        title: sheet.title,
        type: sheet.type,
        page: sheet.page,
        status: sheet.status,
        documentId: sheet.documentId,
        svgContent: '' // Always empty, will be fetched separately
      }
      
      // Check if sheet is already open
      const isAlreadyOpen = openSheets.find(s => s.id === sheet.id)
      console.log('🔍 Sheet already open?', !!isAlreadyOpen)
      
      if (!isAlreadyOpen) {
        console.log('🔄 Fetching SVG content separately for sheet:', sheet.code)
        // Always fetch SVG content separately to avoid chunking issues
        fetchSheetSvgAndAddTab(sheet.id, newSheet)
      } else {
        console.log('ℹ️ Sheet already open, just selecting it:', sheet.code)
      }
      
      console.log('🎯 Setting selected sheet:', sheet.code)
      setSelectedSheet(newSheet)
      console.log('🎯 Setting active sheet ID:', sheet.id)
      setActiveSheetId(sheet.id)
    }
  }

  // Fetch SVG content for a sheet separately
  const fetchSheetSvg = async (sheetId: number) => {
    try {
      console.log('🔄 Fetching SVG content for sheet ID:', sheetId)
      const response = await fetch(`http://localhost:8080/api/sheets/${sheetId}`)
      if (response.ok) {
        const sheetData = await response.json()
        if (sheetData.svgContent) {
          console.log('✅ Successfully fetched SVG content')
          setSvgContent(sheetData.svgContent)
        } else {
          console.log('❌ Sheet data does not contain SVG content')
        }
      } else {
        console.error('❌ Failed to fetch sheet data:', response.status)
      }
    } catch (error) {
      console.error('❌ Error fetching sheet SVG:', error)
    }
  }

  // Fetch SVG content and add sheet to tabs
  const fetchSheetSvgAndAddTab = async (sheetId: number, sheet: Sheet) => {
    try {
      console.log('🔄 Fetching SVG content for tab:', sheetId, 'Sheet code:', sheet.code)
      const response = await fetch(`http://localhost:8080/api/sheets/${sheetId}`)
      console.log('🔄 Fetch response status:', response.status, response.statusText)
      
      if (response.ok) {
        const sheetData = await response.json()
        console.log('📄 Fetched sheet data keys:', Object.keys(sheetData))
        console.log('🔍 Fetched svgContent length:', sheetData.svgContent ? sheetData.svgContent.length : 'null/undefined')
        
        if (sheetData.svgContent) {
          console.log('✅ Successfully fetched SVG content for tab, adding to sheets')
          const updatedSheet = { ...sheet, svgContent: sheetData.svgContent }
          setOpenSheets(prev => {
            // Check if sheet already exists
            const exists = prev.find(s => s.id === updatedSheet.id)
            if (exists) {
              console.log('ℹ️ Sheet already exists, updating SVG content')
              return prev.map(s => s.id === updatedSheet.id ? updatedSheet : s)
            }
            console.log('🆕 Adding new sheet with fetched SVG to tabs')
            return [...prev, updatedSheet]
          })
        } else {
          console.log('❌ Sheet data does not contain SVG content for tab, adding sheet without SVG')
          // Still add the sheet but without SVG content
          setOpenSheets(prev => {
            // Check if sheet already exists
            const exists = prev.find(s => s.id === sheet.id)
            if (exists) {
              console.log('ℹ️ Sheet already exists, not adding duplicate')
              return prev
            }
            console.log('🆕 Adding sheet without SVG to tabs')
            return [...prev, sheet]
          })
        }
      } else {
        console.error('❌ Failed to fetch sheet data:', response.status)
        setOpenSheets(prev => {
          // Check if sheet already exists
          const exists = prev.find(s => s.id === sheet.id)
          if (exists) {
            console.log('ℹ️ Sheet already exists, not adding duplicate')
            return prev
          }
          return [...prev, sheet]
        })
      }
    } catch (error) {
      console.error('❌ Error fetching sheet SVG:', error)
      setOpenSheets(prev => {
        // Check if sheet already exists
        const exists = prev.find(s => s.id === sheet.id)
        if (exists) {
          console.log('ℹ️ Sheet already exists, not adding duplicate')
          return prev
        }
        return [...prev, sheet]
      })
    }
  }

  // Stream text with typewriter effect
  const streamText = (text: string, onComplete: () => void) => {
    setStreamingMessage("")
    setIsStreaming(true)
    
    let currentText = ""
    let index = 0
    
    const streamInterval = setInterval(() => {
      if (index < text.length) {
        currentText += text[index]
        setStreamingMessage(currentText)
        index++
      } else {
        clearInterval(streamInterval)
        setIsStreaming(false)
        onComplete()
      }
    }, 5) // Adjust speed here (lower = faster)
  }

  // Handle sending messages with streaming
  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return
    if (!sessionId || isTyping || isStreaming || isExecutingTool) {
      console.error('❌ Cannot send message without session or while processing')
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputMessage,
      sender: 'user',
      timestamp: new Date()
    }

    const messageToProcess = inputMessage
    setMessages(prev => [...prev, userMessage])
    setInputMessage("")
    setIsTyping(true)

    try {
      // Process the message with streaming updates
      const botResponse = await processMessageStream(messageToProcess, (update) => {
        console.log('📡 Processing streaming update:', update)
        
        if (update.type === 'tool_status') {
          setToolStatus(update.message)
          setIsExecutingTool(true)
          setIsTyping(false) // Stop thinking, start tool execution
        } else if (update.type === 'action') {
          setToolStatus(`Executing ${update.action?.action || 'action'}...`)
          // Actions are processed immediately in processMessageStream
        } else if (update.type === 'final' || update.type === 'error') {
          setIsExecutingTool(false)
          setToolStatus("")
          setIsTyping(false)
        }
      })
      
      setIsTyping(false)
      setIsExecutingTool(false)
      setToolStatus("")
      
      // Start streaming the response
      streamText(botResponse, () => {
        // When streaming is complete, add the final message
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: botResponse,
          sender: 'bot',
          timestamp: new Date()
        }
        setMessages(prev => [...prev, botMessage])
        setStreamingMessage("")
      })
      
    } catch (error) {
      console.error('Error processing message:', error)
      setIsTyping(false)
      setIsExecutingTool(false)
      setToolStatus("")
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        sender: 'bot',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    }
  }

  // Handle enter key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Stable callback for active sheet changes
  const handleActiveSheetChange = useCallback((sheet: Sheet | null) => {
    if (sheet) {
      // Find the full sheet data from openSheets
      const fullSheet = openSheets.find(s => s.id === sheet.id)
      setSelectedSheet(fullSheet || sheet)
    } else {
      setSelectedSheet(null)
    }
  }, [openSheets])

  // Stable callback for closing sheets
  const handleCloseSheet = useCallback((sheetId: number) => {
    setOpenSheets(prev => prev.filter(sheet => sheet.id !== sheetId))
    // If the closed sheet was selected, clear selection
    if (selectedSheet?.id === sheetId) {
      setSelectedSheet(null)
    }
  }, [selectedSheet])

  // Start a new chat session
  const startNewChat = async () => {
    try {
      // Clear all current state
      setMessages([])
      setOpenSheets([])
      setSelectedSheet(null)
      setActiveSheetId(null)
      setSvgContent(null)
      setSheetColumns({})
      setSheetGridLines({})
      setSheetMeasurementLines({})
      setSheetWalls({})
      setSheetNonStructuralWalls({})
      setSheetElevations({})
      setCurrentZoomAction(null)
      
      // Create a new session
      const newSessionId = await createSession()
      if (!newSessionId) {
        throw new Error('Failed to create new session')
      }

      // Add welcome message for new session
      const welcomeMessage: Message = {
        id: 'welcome-new',
        content: `Welcome to a fresh conversation! I can help you navigate and work with construction drawing sheets. Try asking me to "open sheet A2.31" or "show me slab drawings for hotel".`,
        sender: 'bot',
        timestamp: new Date()
      }
      setMessages([welcomeMessage])
      
      console.log('✅ Started new chat session:', newSessionId)
    } catch (error) {
      console.error('❌ Error starting new chat:', error)
      // Show error message to user
      const errorMessage: Message = {
        id: 'error-new-chat',
        content: 'Sorry, I had trouble starting a new conversation. Please refresh the page and try again.',
        sender: 'bot',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    }
  }

  return (
    <SidebarInset style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-white/95 backdrop-blur-sm px-6 shadow-sm">
        <SidebarTrigger className="-ml-1 hover:bg-gray-100 rounded-md transition-colors" />
        <Separator orientation="vertical" className="h-6 bg-gray-300" />
        
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 flex-1">
          <Link 
            href="/projects"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors rounded-md px-2 py-1 hover:bg-gray-100"
          >
            <Home className="h-4 w-4" />
            <span className="text-sm font-medium">Projects</span>
          </Link>
          
          <ChevronRight className="h-4 w-4 text-gray-400" />
          
          <Link 
            href={`/projects/${projectId}`}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors rounded-md px-2 py-1 hover:bg-gray-100"
          >
            <span className="text-sm font-medium truncate max-w-48">
              {project?.name || 'Loading...'}
            </span>
          </Link>
          
          <ChevronRight className="h-4 w-4 text-gray-400" />
          
          <div className="flex items-center gap-2 text-gray-900">
            <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-lg">
              <MessageCircle className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">AI Assistant</h1>
              <p className="text-xs text-gray-500">
                Interactive chat for construction drawings
              </p>
            </div>
          </div>
        </nav>
        
        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Link href={`/projects/${projectId}/rfis`}>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-all"
            >
              View RFIs
            </Button>
          </Link>
        </div>
        
      </header>

      <div className="flex flex-1 h-[calc(100vh-4rem)] overflow-hidden">
        {/* Viewer Section - 80% */}
        <div className="w-4/5 border-r flex flex-col overflow-hidden">
          {openSheets.length > 0 ? (
            <MultiTabSVGViewer
              sheets={openSheets}
              onClose={() => setOpenSheets([])}
              onCloseSheet={handleCloseSheet}
              onActiveSheetChange={handleActiveSheetChange}
              className="flex-1 min-h-0"
              columnsToShow={sheetColumns}
              gridLinesToShow={sheetGridLines}
              measurementLinesToShow={sheetMeasurementLines}
              wallsToShow={sheetWalls}
              nonStructuralWallsToShow={sheetNonStructuralWalls}
              elevationsToShow={sheetElevations}
              activeSheetId={activeSheetId || undefined}
              zoomAction={currentZoomAction || undefined}
            />
          ) : (
            <div className="flex items-center justify-center flex-col bg-gray-50" style={{ flex: 1 }}>
              <div className="text-center">
                <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-xl font-medium mb-2">No Sheets Open</h3>
                <p className="text-muted-foreground">
                  Ask the AI Assistant to open a specific sheet to view it here
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Chatbot Section - 20% */}
        <div className="w-1/3 flex flex-col overflow-hidden bg-gray-50/50">
          <div className="p-4 border-b bg-white/80 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold flex items-center gap-2 text-gray-900">
                <Bot className="h-5 w-5 text-blue-600" />
                AI Assistant
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={startNewChat}
                className="text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 px-2 py-1 h-auto"
                title="Start new conversation"
              >
                <Plus className="h-3 w-3 mr-1" />
                New Chat
              </Button>
            </div>
            <p className="text-xs text-gray-600">
              Ask me to open sheets, find drawings, or browse by type
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex gap-3 max-w-[85%] ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
                    message.sender === 'user' 
                      ? 'bg-blue-600' 
                      : 'bg-gray-800'
                  }`}>
                    {message.sender === 'user' ? (
                      <User className="h-4 w-4 text-white" />
                    ) : (
                      <Bot className="h-4 w-4 text-white" />
                    )}
                  </div>
                  <div className={`rounded-2xl px-4 py-3 shadow-sm ${
                    message.sender === 'user' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-white text-gray-900 border border-gray-200'
                  }`}>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    <p className={`text-xs mt-2 ${
                      message.sender === 'user' ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex gap-3 justify-start">
                <div className="flex gap-3 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm bg-gray-800">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="bg-white text-gray-900 border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                    <p className="text-sm text-gray-600">
                      thinking<span className="w-6 inline-block text-left">{thinkingDots}</span>
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            {/* Tool Execution Indicator */}
            {isExecutingTool && toolStatus && (
              <div className="flex gap-3 justify-start">
                <div className="flex gap-3 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm bg-blue-600">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="bg-blue-50 text-blue-900 border border-blue-200 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="text-sm font-medium flex items-start">
                      <div className="w-3 h-3 bg-blue-500 rounded-full mr-2 animate-pulse flex-shrink-0 mt-0.5"></div>
                      <div className="flex-1">{toolStatus}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Streaming Message */}
            {isStreaming && streamingMessage && (
              <div className="flex gap-3 justify-start">
                <div className="flex gap-3 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm bg-gray-800">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="bg-white text-gray-900 border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="text-sm leading-relaxed whitespace-pre-wrap relative">
                      {streamingMessage}
                      <span className="inline-block w-2 h-4 bg-gray-400 ml-1 animate-pulse align-top"></span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t bg-white/80 backdrop-blur-sm">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Ask me to open a sheet, find drawings, or browse by type..."
                  className="pr-12 rounded-2xl border-gray-200 focus:border-blue-400 focus:ring-blue-400/20 bg-gray-50/50 placeholder:text-gray-500"
                  disabled={isTyping || isStreaming || isExecutingTool}
                />
                {inputMessage.trim() && (
                  <button
                    onClick={() => setInputMessage('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button 
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || isTyping || isStreaming || isExecutingTool}
                size="sm"
                className="rounded-2xl bg-blue-600 hover:bg-blue-700 shadow-sm transition-all duration-200 disabled:opacity-50"
              >
                {isTyping || isStreaming || isExecutingTool ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
              <span>Press Enter to send, Shift+Enter for new line</span>
              {sessionId && (
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  Connected
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  )
}