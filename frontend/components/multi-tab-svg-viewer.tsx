"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { X, ZoomIn, ZoomOut } from "lucide-react"
import dynamic from 'next/dynamic'

// Dynamic import wrapper for Konva components - memoized for performance
const KonvaViewer = dynamic(
  () => Promise.all([
    import('react-konva'),
    import('react')
  ]).then(([konvaModule, reactModule]) => {
    const { Stage, Layer, Image: KonvaImage, Rect, Text, Line } = konvaModule
    const { useEffect, Fragment, memo, useState, useRef } = reactModule
    
    return memo(function KonvaViewerComponent({ 
      stageRef, 
      stageSize, 
      currentViewState, 
      handleWheel, 
      handleStageDragEnd, 
      svgImage, 
      svgDimensions,
      columnsToRender,
      gridLinesToRender,
      measurementLinesToRender,
      wallsToRender,
      nonStructuralWallsToRender,
      elevationsToRender
    }: any) {
      // Animation state for overlays
      const [overlayAnimations, setOverlayAnimations] = useState<Record<string, { opacity: number; scale: number; timestamp: number }>>({})
      const animationRefs = useRef<Record<string, number>>({})
      
      // Animate overlay appearance
      const animateOverlay = (key: string) => {
        const startTime = performance.now()
        const duration = 800 // 0.8 seconds
        
        const animate = (currentTime: number) => {
          const elapsed = currentTime - startTime
          const progress = Math.min(elapsed / duration, 1)
          
          // Ease-out-back for bouncy effect
          const easeOutBack = (t: number) => {
            const c1 = 1.70158
            const c3 = c1 + 1
            return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
          }
          
          const easedProgress = easeOutBack(progress)
          
          setOverlayAnimations(prev => ({
            ...prev,
            [key]: {
              opacity: progress,
              scale: 0.3 + (0.7 * easedProgress), // Start small, end at normal size
              timestamp: Date.now()
            }
          }))
          
          if (progress < 1) {
            animationRefs.current[key] = requestAnimationFrame(animate)
          } else {
            delete animationRefs.current[key]
          }
        }
        
        animationRefs.current[key] = requestAnimationFrame(animate)
      }
      
      // Trigger animations when overlays appear
      useEffect(() => {
        const allOverlays = [
          ...columnsToRender.map((col: any, i: number) => `column-${col.id || i}`),
          ...gridLinesToRender.map((line: any, i: number) => `grid-${line.id || i}`),
          ...measurementLinesToRender.map((_: any, i: number) => `measurement-${i}`),
          ...wallsToRender.map((wall: any, i: number) => `wall-${wall.id || i}`),
          ...nonStructuralWallsToRender.map((wall: any, i: number) => `non-structural-wall-${wall.id || i}`),
          ...elevationsToRender.map((elev: any, i: number) => `elevation-${elev.id || i}`)
        ]
        
        allOverlays.forEach(key => {
          if (!overlayAnimations[key]) {
            animateOverlay(key)
          }
        })
        
        // Cleanup animations for removed overlays
        Object.keys(overlayAnimations).forEach(key => {
          if (!allOverlays.includes(key)) {
            if (animationRefs.current[key]) {
              cancelAnimationFrame(animationRefs.current[key])
              delete animationRefs.current[key]
            }
            setOverlayAnimations(prev => {
              const { [key]: removed, ...rest } = prev
              return rest
            })
          }
        })
        
        return () => {
          // Cleanup all animations on unmount
          Object.values(animationRefs.current).forEach(cancelAnimationFrame)
          animationRefs.current = {}
        }
      }, [columnsToRender.length, gridLinesToRender.length, measurementLinesToRender.length, wallsToRender.length, nonStructuralWallsToRender.length, elevationsToRender.length])
      
      // Use useEffect to update stage position/scale to avoid conflicts with draggable
      useEffect(() => {
        if (stageRef.current) {
          const stage = stageRef.current
          stage.scale({ x: currentViewState.scale, y: currentViewState.scale })
          stage.position({ x: currentViewState.translateX, y: currentViewState.translateY })
          stage.batchDraw()
        }
      }, [currentViewState.scale, currentViewState.translateX, currentViewState.translateY])
      
      return (
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          draggable
          onWheel={handleWheel}
          onDragEnd={handleStageDragEnd}
          style={{ cursor: 'grab' }}
        >
          <Layer>
            <KonvaImage
              image={svgImage}
              width={svgDimensions?.width || 3024}
              height={svgDimensions?.height || 2160}
            />
            {/* Render column overlays */}
            {columnsToRender && columnsToRender.map((column: any, index: number) => {
              // Use color from backend or default to red for backwards compatibility
              const color = column.highlightColor || column.color || "#FF0000"
              // Convert hex color to rgba for fill
              const hexToRgba = (hex: string, alpha: number = 0.1) => {
                const r = parseInt(hex.slice(1, 3), 16)
                const g = parseInt(hex.slice(3, 5), 16)
                const b = parseInt(hex.slice(5, 7), 16)
                return `rgba(${r}, ${g}, ${b}, ${alpha})`
              }
              
              // Generate label from column data or use index
              const label = column.label || `C${column.column_index || column.index || index}`
              const animKey = `column-${column.id || index}`
              const animation = overlayAnimations[animKey] || { opacity: 0, scale: 0.3 }
              
              return (
                <Fragment key={animKey}>
                  <Rect
                    x={column.center_x}
                    y={column.center_y}
                    width={column.width}
                    height={column.height}
                    stroke={color}
                    strokeWidth={3}
                    fill={hexToRgba(color)}
                    listening={false}
                    opacity={animation.opacity}
                    scaleX={animation.scale}
                    scaleY={animation.scale}
                    offsetX={column.width / 2}
                    offsetY={column.height / 2}
                  />
                  <Text
                    x={column.center_x}
                    y={column.center_y}
                    text={label}
                    fontSize={12}
                    fontFamily="Arial"
                    fontWeight="bold"
                    fill="#000000"
                    align="center"
                    verticalAlign="middle"
                    listening={false}
                    opacity={animation.opacity}
                    scaleX={animation.scale}
                    scaleY={animation.scale}
                  />
                </Fragment>
              )
            })}
            {/* Render grid line overlays */}
            {gridLinesToRender && gridLinesToRender.map((gridLine: any, index: number) => {
              const isVertical = gridLine.orientation === 'vertical'
              const isHotel = gridLine.category === 'hotel'
              const color = isHotel ? '#0066FF' : '#FF6600' // Blue for hotel, orange for residence
              const bgColor = isHotel ? 'rgba(0, 102, 255, 0.1)' : 'rgba(255, 102, 0, 0.1)'
              const animKey = `grid-${gridLine.id || index}`
              const animation = overlayAnimations[animKey] || { opacity: 0, scale: 0.3 }
              
              // Get drawing dimensions for full-length lines
              const drawingWidth = svgDimensions?.width || 3024
              const drawingHeight = svgDimensions?.height || 2160
              
              return (
                <Fragment key={animKey}>
                  {/* Grid line - extends across entire drawing */}
                  <Line
                    points={isVertical 
                      ? [gridLine.center_x, 0, gridLine.center_x, drawingHeight] // Vertical line
                      : [0, gridLine.center_y, drawingWidth, gridLine.center_y]  // Horizontal line
                    }
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.7 * animation.opacity}
                    listening={false}
                    scaleX={isVertical ? 1 : animation.scale}
                    scaleY={isVertical ? animation.scale : 1}
                  />
                  {/* Grid line label background */}
                  <Rect
                    x={gridLine.center_x}
                    y={gridLine.center_y}
                    width={gridLine.bbox_width}
                    height={gridLine.bbox_height}
                    stroke={color}
                    strokeWidth={1}
                    fill={bgColor}
                    listening={false}
                    opacity={animation.opacity}
                    scaleX={animation.scale}
                    scaleY={animation.scale}
                    offsetX={gridLine.bbox_width / 2}
                    offsetY={gridLine.bbox_height / 2}
                  />
                  {/* Grid line label text */}
                  <Text
                    x={gridLine.center_x - gridLine.bbox_width / 2}
                    y={gridLine.center_y - gridLine.bbox_height / 2}
                    width={gridLine.bbox_width}
                    height={gridLine.bbox_height}
                    text={gridLine.label}
                    fontSize={12}
                    fontFamily="Arial"
                    fontWeight="bold"
                    fill={color}
                    align="center"
                    verticalAlign="middle"
                    listening={false}
                    opacity={animation.opacity}
                    scaleX={animation.scale}
                    scaleY={animation.scale}
                  />
                </Fragment>
              )
            })}
            {/* Render measurement line overlays */}
            {measurementLinesToRender && measurementLinesToRender.map((measurementLine: any, index: number) => {
              // Skip lines with invalid distance text
              if (measurementLine.distance_text === "no distance found" || 
                  !measurementLine.distance_text || 
                  measurementLine.length_inches === null || 
                  measurementLine.length_inches === undefined ||
                  measurementLine.length_inches === 0) {
                return null
              }
              
              const color = measurementLine.color || '#2196F3' // Default blue color
              const strokeWidth = measurementLine.stroke_width || 2
              const animKey = `measurement-${index}`
              const animation = overlayAnimations[animKey] || { opacity: 0, scale: 0.3 }
              
              // Calculate line properties
              const deltaX = measurementLine.end_x - measurementLine.start_x
              const deltaY = measurementLine.end_y - measurementLine.start_y
              const lineLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
              
              // Determine if line is more horizontal or vertical
              const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY)
              
              // Calculate midpoint for text placement
              const midX = (measurementLine.start_x + measurementLine.end_x) / 2
              const midY = (measurementLine.start_y + measurementLine.end_y) / 2
              
              // Calculate text position and rotation with perfect center alignment
              let rotation = 0
              
              if (isHorizontal) {
                // Horizontal line: text perfectly centered on line
                rotation = 0
              } else {
                // Vertical line: text perfectly centered on line, rotated
                rotation = -90 // Rotate 90 degrees counterclockwise
              }
              
              return (
                <Fragment key={animKey}>
                  {/* Measurement line */}
                  <Line
                    points={[
                      measurementLine.start_x, measurementLine.start_y, 
                      measurementLine.end_x, measurementLine.end_y
                    ]}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    opacity={0.8 * animation.opacity}
                    listening={false}
                    scaleX={animation.scale}
                    scaleY={animation.scale}
                  />
                  {/* Measurement text - smaller and perfectly centered */}
                  <Text
                    x={midX}
                    y={midY}
                    text={measurementLine.distance_text}
                    fontSize={6}
                    fontFamily="Arial"
                    fontWeight="bold"
                    fill={color}
                    align="center"
                    verticalAlign="middle"
                    rotation={rotation}
                    listening={false}
                    opacity={animation.opacity}
                    scaleX={animation.scale}
                    scaleY={animation.scale}
                  />
                </Fragment>
              )
            })}
            {/* Render wall overlays */}
            {wallsToRender && wallsToRender.map((wall: any, index: number) => {
              // Use color from backend or default to orange for backwards compatibility
              const color = wall.highlightColor || wall.color || "#FF9800" // Default orange for walls
              // Convert hex color to rgba for fill
              const hexToRgba = (hex: string, alpha: number = 0.1) => {
                const r = parseInt(hex.slice(1, 3), 16)
                const g = parseInt(hex.slice(3, 5), 16)
                const b = parseInt(hex.slice(5, 7), 16)
                return `rgba(${r}, ${g}, ${b}, ${alpha})`
              }
              
              // Generate label from wall data or use index
              const label = wall.label || `W${wall.index || index}`
              const animKey = `wall-${wall.id || index}`
              const animation = overlayAnimations[animKey] || { opacity: 0, scale: 0.3 }
              
              return (
                <Fragment key={animKey}>
                  <Rect
                    x={wall.center_x}
                    y={wall.center_y}
                    width={wall.width}
                    height={wall.height}
                    stroke={color}
                    strokeWidth={3}
                    fill={hexToRgba(color)}
                    listening={false}
                    opacity={animation.opacity}
                    scaleX={animation.scale}
                    scaleY={animation.scale}
                    offsetX={wall.width / 2}
                    offsetY={wall.height / 2}
                  />
                  <Text
                    x={wall.center_x}
                    y={wall.center_y}
                    text={label}
                    fontSize={12}
                    fontFamily="Arial"
                    fontWeight="bold"
                    fill="#000000"
                    align="center"
                    verticalAlign="middle"
                    listening={false}
                    opacity={animation.opacity}
                    scaleX={animation.scale}
                    scaleY={animation.scale}
                  />
                </Fragment>
              )
            })}
            {/* Render non-structural wall overlays */}
            {nonStructuralWallsToRender && nonStructuralWallsToRender.length > 0 && console.log(`🎨 Rendering ${nonStructuralWallsToRender.length} non-structural walls`)}
            {nonStructuralWallsToRender && nonStructuralWallsToRender.map((wall: any, index: number) => {
              // Use color from backend or default to light orange for non-structural walls
              const color = wall.highlightColor || wall.color || "#FFB74D" // Light orange for non-structural walls
              // Convert hex color to rgba for fill
              const hexToRgba = (hex: string, alpha: number = 0.1) => {
                const r = parseInt(hex.slice(1, 3), 16)
                const g = parseInt(hex.slice(3, 5), 16)
                const b = parseInt(hex.slice(5, 7), 16)
                return `rgba(${r}, ${g}, ${b}, ${alpha})`
              }
              
              const animKey = `non-structural-wall-${wall.id || index}`
              const animation = overlayAnimations[animKey] || { opacity: 0, scale: 0.3 }
              
              return (
                <Rect
                  key={animKey}
                  x={wall.x}
                  y={wall.y}
                  width={wall.width}
                  height={wall.height}
                  fill={color}
                  listening={false}
                  opacity={animation.opacity}
                  scaleX={animation.scale}
                  scaleY={animation.scale}
                />
              )
            })}
            {/* Render elevation overlays */}
            {elevationsToRender && elevationsToRender.map((elevation: any, index: number) => {
              // Use color from backend or default to orange for elevations
              const color = elevation.color || "#FF5722" // Default orange color for elevations
              // Convert hex color to rgba for fill
              const hexToRgba = (hex: string, alpha: number = 0.1) => {
                const r = parseInt(hex.slice(1, 3), 16)
                const g = parseInt(hex.slice(3, 5), 16)
                const b = parseInt(hex.slice(5, 7), 16)
                return `rgba(${r}, ${g}, ${b}, ${alpha})`
              }
              
              const animKey = `elevation-${elevation.id || index}`
              const animation = overlayAnimations[animKey] || { opacity: 0, scale: 0.3 }
              
              return (
                <Rect
                  key={animKey}
                  x={elevation.bbox.x}
                  y={elevation.bbox.y}
                  width={elevation.bbox.width}
                  height={elevation.bbox.height}
                  stroke={color}
                  strokeWidth={3}
                  fill={hexToRgba(color)}
                  listening={false}
                  opacity={animation.opacity}
                  scaleX={animation.scale}
                  scaleY={animation.scale}
                />
              )
            })}
          </Layer>
        </Stage>
      )
    })
  }),
  { 
    ssr: false,
    loading: () => <div className="flex items-center justify-center h-full"><div className="text-muted-foreground">Loading viewer...</div></div>
  }
)

interface Sheet {
  id: number;
  code: string;
  title: string;
  svgContent?: string;
}

interface Column {
  id: number;
  index: number;
  center_x: number;
  center_y: number;
  width: number;
  height: number;
  created_at: string;
}

interface GridLine {
  id: number;
  label: string;
  category: string;
  orientation: string;
  center_x: number;
  center_y: number;
  bbox_width: number;
  bbox_height: number;
  created_at: string;
}

interface Wall {
  id: number;
  index: number;
  center_x: number;
  center_y: number;
  width: number;
  height: number;
  orientation: string;
  thickness: number;
  length: number;
  aspect_ratio: number;
  created_at: string;
  highlighted?: boolean;
  highlightColor?: string;
  color?: string;
}

interface MeasurementLine {
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  distance_text: string;
  length_inches: number;
  color?: string;
  stroke_width?: number;
}

interface ViewState {
  scale: number;
  translateX: number;
  translateY: number;
}

interface ZoomAction {
  sheetId: number;
  center_x: number;
  center_y: number;
  zoom_level: number;
  timestamp: number;
}

interface MultiTabSVGViewerProps {
  sheets: Sheet[];
  onClose?: () => void;
  onCloseSheet?: (sheetId: number) => void;
  className?: string;
  onActiveSheetChange?: (sheet: Sheet | null) => void;
  columnsToShow?: Record<number, Column[]>; // sheetId -> columns
  gridLinesToShow?: Record<number, GridLine[]>; // sheetId -> grid lines
  measurementLinesToShow?: Record<number, MeasurementLine[]>; // sheetId -> measurement lines
  wallsToShow?: Record<number, Wall[]>; // sheetId -> walls
  nonStructuralWallsToShow?: Record<number, any[]>; // sheetId -> non-structural walls
  elevationsToShow?: Record<number, any[]>; // sheetId -> elevations
  activeSheetId?: number; // Optional prop to control which sheet should be active
  zoomAction?: ZoomAction; // Optional zoom action to execute
}

export function MultiTabSVGViewer({ sheets, onClose, onCloseSheet, className, onActiveSheetChange, columnsToShow, gridLinesToShow, measurementLinesToShow, wallsToShow, nonStructuralWallsToShow, elevationsToShow, activeSheetId, zoomAction }: MultiTabSVGViewerProps) {
  const [activeTab, setActiveTab] = useState<number>(0)
  const [viewStates, setViewStates] = useState<Record<number, ViewState>>({})
  const [svgImages, setSvgImages] = useState<Record<number, HTMLImageElement>>({})
  // Initialize with reasonable default size instead of 0,0
  const [stageSize, setStageSize] = useState(() => {
    // Calculate initial size from window dimensions
    const initialWidth = Math.floor(window.innerWidth * 0.8 - 40)
    const initialHeight = Math.floor(window.innerHeight - 200)
    return { 
      width: Math.max(400, initialWidth), 
      height: Math.max(300, initialHeight) 
    }
  })
  const [svgDimensions, setSvgDimensions] = useState<Record<number, { width: number, height: number }>>({})
  const [processedZoomTimestamp, setProcessedZoomTimestamp] = useState<number | null>(null)
  
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<any>(null)

  // Calculate available space for the stage - memoized for performance
  const calculateAvailableSpace = useCallback(() => {
    if (!svgContainerRef.current) return { width: 0, height: 0 }

    const container = svgContainerRef.current
    const containerRect = container.getBoundingClientRect()
    
    let availableWidth = containerRect.width
    let availableHeight = containerRect.height

    // If container dimensions are still 0, calculate from parent chain
    if (availableWidth === 0 || availableHeight === 0) {
      // Walk up the DOM tree to find a sized parent
      let parent = container.parentElement
      while (parent && (availableWidth === 0 || availableHeight === 0)) {
        const parentRect = parent.getBoundingClientRect()
        if (parentRect.width > 0 && parentRect.height > 0) {
          availableWidth = parentRect.width
          availableHeight = parentRect.height
          break
        }
        parent = parent.parentElement
      }
    }

    // Final fallback: calculate from viewport and layout
    if (availableWidth === 0 || availableHeight === 0) {
      // For 80% viewer section minus some padding
      availableWidth = Math.floor(window.innerWidth * 0.8 - 40) // Account for borders/padding
      availableHeight = Math.floor(window.innerHeight - 200) // Account for header, tab bar, status bar
    }

    return { 
      width: Math.max(100, availableWidth), 
      height: Math.max(100, availableHeight) 
    }
  }, [])

  // Initialize view states for all sheets
  useEffect(() => {
    setViewStates(prev => {
      const newStates = { ...prev }
      let hasChanges = false
      
      sheets.forEach((sheet) => {
        if (!newStates[sheet.id]) {
          newStates[sheet.id] = {
            scale: 1,
            translateX: 0,
            translateY: 0
          }
          hasChanges = true
        }
      })
      
      return hasChanges ? newStates : prev
    })
  }, [sheets])

  // Ensure activeTab is within bounds - memoized
  const safeActiveTab = useMemo(() => Math.min(activeTab, sheets.length - 1), [activeTab, sheets.length])
  const currentSheet = useMemo(() => sheets[safeActiveTab], [sheets, safeActiveTab])
  const currentViewState = useMemo(() => 
    currentSheet ? (viewStates[currentSheet.id] || { scale: 1, translateX: 0, translateY: 0 }) : { scale: 1, translateX: 0, translateY: 0 },
    [currentSheet, viewStates]
  )

  // Memoize overlay data for current sheet to prevent unnecessary re-renders
  const currentOverlayData = useMemo(() => {
    const sheetId = currentSheet?.id
    const nsWalls = sheetId ? (nonStructuralWallsToShow?.[sheetId] || []) : []
    const elevations = sheetId ? (elevationsToShow?.[sheetId] || []) : []
    if (nsWalls.length > 0) {
      console.log(`📊 Found ${nsWalls.length} non-structural walls for sheet ${sheetId}`)
    }
    if (elevations.length > 0) {
      console.log(`🏗️ Found ${elevations.length} elevations for sheet ${sheetId}`)
    }
    return {
      columns: sheetId ? (columnsToShow?.[sheetId] || []) : [],
      gridLines: sheetId ? (gridLinesToShow?.[sheetId] || []) : [],
      measurementLines: sheetId ? (measurementLinesToShow?.[sheetId] || []) : [],
      walls: sheetId ? (wallsToShow?.[sheetId] || []) : [],
      nonStructuralWalls: nsWalls,
      elevations: elevations
    }
  }, [currentSheet?.id, columnsToShow, gridLinesToShow, measurementLinesToShow, wallsToShow, nonStructuralWallsToShow, elevationsToShow])

  // Update activeTab if it's out of bounds
  useEffect(() => {
    if (activeTab >= sheets.length && sheets.length > 0) {
      setActiveTab(sheets.length - 1)
    }
  }, [sheets.length, activeTab])

  // Update activeTab when sheets array changes and we have an activeSheetId
  useEffect(() => {
    if (activeSheetId && sheets.length > 0) {
      const sheetIndex = sheets.findIndex(sheet => sheet.id === activeSheetId)
      // Only switch if the target sheet exists and it's the last sheet (newly added)
      if (sheetIndex !== -1 && sheetIndex === sheets.length - 1) {
        setActiveTab(sheetIndex)
        console.log(`🎯 Auto-switching to newly added sheet ${activeSheetId} at index ${sheetIndex}`)
      }
    }
  }, [sheets.length, activeSheetId]) // Only trigger when sheets change, not activeSheetId alone

  // Notify parent when active sheet changes
  useEffect(() => {
    if (onActiveSheetChange) {
      onActiveSheetChange(currentSheet || null)
    }
  }, [currentSheet]) // Removed onActiveSheetChange from dependencies

  // Convert SVG content to images for Konva rendering - optimized
  useEffect(() => {
    const loadPromises: Promise<void>[] = []
    
    sheets.forEach(sheet => {
      if (sheet.svgContent && !svgImages[sheet.id]) {
        const loadPromise = new Promise<void>((resolve) => {
          const svgBlob = new Blob([sheet.svgContent!], { type: 'image/svg+xml;charset=utf-8' })
          const url = URL.createObjectURL(svgBlob)
          
          const img = new window.Image()
          img.onload = () => {
            setSvgImages(prev => ({ ...prev, [sheet.id]: img }))
            URL.revokeObjectURL(url)
            
            // Extract SVG dimensions
            const parser = new DOMParser()
            const svgDoc = parser.parseFromString(sheet.svgContent!, 'image/svg+xml')
            const svgElement = svgDoc.querySelector('svg')
            
            if (svgElement) {
              let width = 3024 // default
              let height = 2160 // default
              
              // Try to get dimensions from viewBox first
              const viewBox = svgElement.getAttribute('viewBox')
              if (viewBox) {
                const [, , w, h] = viewBox.split(' ').map(Number)
                width = w
                height = h
              } else {
                // Fallback to width/height attributes
                const w = parseFloat(svgElement.getAttribute('width') || '3024')
                const h = parseFloat(svgElement.getAttribute('height') || '2160')
                width = w
                height = h
              }
              
              setSvgDimensions(prev => ({ ...prev, [sheet.id]: { width, height } }))
            }
            resolve()
          }
          img.onerror = () => {
            console.error(`Failed to load SVG image for sheet ${sheet.code}`)
            URL.revokeObjectURL(url)
            resolve()
          }
          img.src = url
        })
        
        loadPromises.push(loadPromise)
      }
    })
    
    // Clean up unused images
    const currentSheetIds = new Set(sheets.map(s => s.id))
    setSvgImages(prev => {
      const filtered = Object.fromEntries(
        Object.entries(prev).filter(([id]) => currentSheetIds.has(Number(id)))
      )
      return Object.keys(filtered).length !== Object.keys(prev).length ? filtered : prev
    })
  }, [sheets.map(s => `${s.id}-${s.svgContent?.length || 0}`).join(',')])


  // Update view state for current sheet
  const updateViewState = useCallback((updates: Partial<ViewState>) => {
    if (!currentSheet) return
    
    const defaultViewState = { scale: 1, translateX: 0, translateY: 0 }
    const existingViewState = currentViewState || defaultViewState
    
    setViewStates(prev => ({
      ...prev,
      [currentSheet.id]: {
        ...existingViewState,
        ...updates
      }
    }))
  }, [currentSheet, currentViewState])

  // Handle container resize for Konva stage - with aggressive initial sizing
  useEffect(() => {
    let rafId: number
    let intersectionObserver: IntersectionObserver | null = null
    
    const updateSize = () => {
      const { width: newWidth, height: newHeight } = calculateAvailableSpace()
      
      // Always update, even with fallback dimensions
      setStageSize(prev => {
        // Only update if size actually changed (with small threshold to avoid micro-updates)
        const threshold = 5
        if (Math.abs(prev.width - newWidth) > threshold || Math.abs(prev.height - newHeight) > threshold) {
          console.log('📐 Stage size updated:', { from: prev, to: { width: newWidth, height: newHeight } })
          return { width: newWidth, height: newHeight }
        }
        return prev
      })
    }

    const debouncedUpdateSize = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateSize)
    }

    // Aggressive initial sizing attempts
    const attemptInitialSizing = () => {
      // Force immediate update
      updateSize()
      
      // Use requestAnimationFrame for next frame updates
      requestAnimationFrame(() => {
        updateSize()
        requestAnimationFrame(updateSize)
      })
      
      // Additional delayed attempts with exponential backoff
      const delays = [10, 25, 50, 100, 200, 400, 800]
      delays.forEach(delay => {
        setTimeout(updateSize, delay)
      })
    }

    // Start aggressive initial sizing
    attemptInitialSizing()
    
    // Set up intersection observer to detect when container becomes visible
    if (svgContainerRef.current) {
      intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // Container is visible, try to get its dimensions
            setTimeout(updateSize, 10)
            setTimeout(updateSize, 50)
          }
        })
      }, { threshold: 0.1 })
      
      intersectionObserver.observe(svgContainerRef.current)
    }
    
    // Window resize handler
    window.addEventListener('resize', debouncedUpdateSize)

    // ResizeObserver for container changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          debouncedUpdateSize()
        }
      }
    })
    
    if (svgContainerRef.current) {
      resizeObserver.observe(svgContainerRef.current)
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', debouncedUpdateSize)
      resizeObserver.disconnect()
      intersectionObserver?.disconnect()
    }
  }, [calculateAvailableSpace])

  // Ensure proper size calculation when sheets change or container becomes available
  useEffect(() => {
    if (sheets.length > 0) {
      // Force a size recalculation when sheets change
      const recalculateSize = () => {
        const { width, height } = calculateAvailableSpace()
        if (width > 100 && height > 100) {
          setStageSize(prev => {
            const threshold = 5
            if (Math.abs(prev.width - width) > threshold || Math.abs(prev.height - height) > threshold) {
              console.log('📋 Sheet change triggered size update:', { from: prev, to: { width, height } })
              return { width, height }
            }
            return prev
          })
        }
      }
      
      // Multiple attempts to ensure sizing works
      recalculateSize()
      const timeout1 = setTimeout(recalculateSize, 50)
      const timeout2 = setTimeout(recalculateSize, 150)
      
      return () => {
        clearTimeout(timeout1)
        clearTimeout(timeout2)
      }
    }
  }, [sheets.length, calculateAvailableSpace])

  // Additional effect to handle when container ref becomes available
  useEffect(() => {
    if (svgContainerRef.current && stageSize.width < 400) {
      // Container is now available but stage size might still be too small
      const forceResize = () => {
        const { width, height } = calculateAvailableSpace()
        if (width > 100 && height > 100) {
          console.log('🎯 Container ref available, forcing size update:', { width, height })
          setStageSize({ width, height })
        }
      }
      
      // Immediate and delayed attempts
      forceResize()
      setTimeout(forceResize, 10)
      setTimeout(forceResize, 50)
    }
  }, [svgContainerRef.current, calculateAvailableSpace])

  // Fit to container using Konva dimensions
  const fitToContainer = useCallback(() => {
    if (!currentSheet || !svgImages[currentSheet.id] || stageSize.width === 0 || stageSize.height === 0) return

    const svgDim = svgDimensions[currentSheet.id]
    if (!svgDim) return

    const scaleX = stageSize.width / svgDim.width
    const scaleY = stageSize.height / svgDim.height
    const scale = Math.min(scaleX, scaleY) * 0.9 // 90% to add some padding

    updateViewState({
      scale,
      translateX: (stageSize.width - svgDim.width * scale) / 2,
      translateY: (stageSize.height - svgDim.height * scale) / 2
    })
  }, [currentSheet, svgImages, svgDimensions, stageSize, updateViewState])

  // Auto-fit new sheets to container (one-time only)
  useEffect(() => {
    if (currentSheet && svgImages[currentSheet.id] && stageSize.width > 100 && stageSize.height > 100) {
      // Only auto-fit if this sheet doesn't have a custom view state yet
      const currentViewState = viewStates[currentSheet.id]
      const hasCustomViewState = currentViewState && 
        (currentViewState.scale !== 1 || 
         currentViewState.translateX !== 0 || 
         currentViewState.translateY !== 0)
      
      if (!hasCustomViewState) {
        // Inline fit logic to avoid circular dependency
        const svgDim = svgDimensions[currentSheet.id]
        if (svgDim) {
          const scaleX = stageSize.width / svgDim.width
          const scaleY = stageSize.height / svgDim.height
          const scale = Math.min(scaleX, scaleY) * 0.9

          // Use direct state update to avoid updateViewState dependency
          setViewStates(prev => ({
            ...prev,
            [currentSheet.id]: {
              scale,
              translateX: (stageSize.width - svgDim.width * scale) / 2,
              translateY: (stageSize.height - svgDim.height * scale) / 2
            }
          }))
        }
      }
    }
  }, [currentSheet?.id, svgImages, stageSize.width, stageSize.height, svgDimensions])

  // Smooth zoom animation function
  const animateZoomToPosition = useCallback((targetScale: number, targetCenterX: number, targetCenterY: number, sheetId: number) => {
    const currentViewState = viewStates[sheetId] || { scale: 1, translateX: 0, translateY: 0 }
    
    // Calculate target stage position to center the point
    const targetStageX = (stageSize.width / 2) - (targetCenterX * targetScale)
    const targetStageY = (stageSize.height / 2) - (targetCenterY * targetScale)
    
    // Animation parameters
    const duration = 1000 // 1 second
    const startTime = performance.now()
    const startScale = currentViewState.scale
    const startX = currentViewState.translateX
    const startY = currentViewState.translateY
    
    // Easing function (ease-in-out)
    const easeInOutQuad = (t: number): number => {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    }
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeInOutQuad(progress)
      
      // Interpolate values
      const currentScale = startScale + (targetScale - startScale) * easedProgress
      const currentX = startX + (targetStageX - startX) * easedProgress
      const currentY = startY + (targetStageY - startY) * easedProgress
      
      // Update view state
      setViewStates(prev => ({
        ...prev,
        [sheetId]: {
          scale: currentScale,
          translateX: currentX,
          translateY: currentY
        }
      }))
      
      // Continue animation or finish
      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        console.log('✅ Smooth zoom animation completed')
      }
    }
    
    requestAnimationFrame(animate)
  }, [viewStates, stageSize])

  // Handle zoom actions with smooth animation
  useEffect(() => {
    if (zoomAction && 
        currentSheet && 
        currentSheet.id === zoomAction.sheetId && 
        stageSize.width > 0 && 
        stageSize.height > 0 &&
        processedZoomTimestamp !== zoomAction.timestamp) {
      
      console.log(`🎬 Starting smooth zoom animation to (${zoomAction.center_x}, ${zoomAction.center_y}) at ${zoomAction.zoom_level}x`)
      
      // Start smooth zoom animation
      animateZoomToPosition(
        zoomAction.zoom_level,
        zoomAction.center_x,
        zoomAction.center_y,
        currentSheet.id
      )
      
      // Mark this timestamp as processed
      setProcessedZoomTimestamp(zoomAction.timestamp)
    }
  }, [zoomAction, currentSheet, stageSize.width, stageSize.height, processedZoomTimestamp, animateZoomToPosition])

  // Handle zoom for button controls
  const handleZoom = useCallback((delta: number, centerX?: number, centerY?: number) => {
    if (!currentSheet) return

    const mouseX = centerX ?? stageSize.width / 2
    const mouseY = centerY ?? stageSize.height / 2

    const scaleFactor = delta > 0 ? 1.25 : 0.8
    const newScale = Math.max(0.05, Math.min(10, currentViewState.scale * scaleFactor))

    const scaleChange = newScale / currentViewState.scale
    const newTranslateX = mouseX - (mouseX - currentViewState.translateX) * scaleChange
    const newTranslateY = mouseY - (mouseY - currentViewState.translateY) * scaleChange

    updateViewState({
      scale: newScale,
      translateX: newTranslateX,
      translateY: newTranslateY
    })
  }, [currentSheet, currentViewState, updateViewState, stageSize])

  // Handle wheel zoom for Konva stage - zoom towards cursor position
  const handleWheel = useCallback((e: any) => {
    e.evt.preventDefault()
    
    const stage = e.target.getStage()
    const oldScale = stage.scaleX()
    
    // Get pointer position relative to the stage
    const pointer = stage.getPointerPosition()
    
    if (!pointer) return // Safety check
    
    // Calculate the world coordinates of the mouse position before scaling
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }

    const scaleBy = 1.1
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy
    const clampedScale = Math.max(0.1, Math.min(5, newScale))

    // Calculate new stage position to keep the mouse point in the same place
    const newStagePos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale
    }

    updateViewState({
      scale: clampedScale,
      translateX: newStagePos.x,
      translateY: newStagePos.y
    })
  }, [updateViewState])

  // Handle stage drag for Konva
  const handleStageDragEnd = useCallback((e: any) => {
    updateViewState({
      translateX: e.target.x(),
      translateY: e.target.y()
    })
  }, [updateViewState])

  // Reset view
  const resetView = useCallback(() => {
    updateViewState({
      scale: 1,
      translateX: 0,
      translateY: 0
    })
  }, [updateViewState])

  // Close tab
  const closeTab = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const sheet = sheets[index]
    
    if (sheets.length === 1 && onClose) {
      onClose()
    } else if (onCloseSheet && sheet) {
      onCloseSheet(sheet.id)
    }
  }, [sheets, onClose, onCloseSheet])

  if (sheets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <p className="text-muted-foreground">No sheets to display</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <style jsx>{`
        .tab-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div className={`flex flex-col ${className}`} style={{ height: '100%', width: '100%' }}>
      {/* Tab Bar */}
      <div className="flex items-center bg-white border-b border-gray-200 shadow-sm" style={{ height: '52px', flexShrink: 0 }}>
        <div className="flex-1 flex items-center overflow-x-auto tab-scroll" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {sheets.map((sheet, index) => {
            const isActive = safeActiveTab === index
            return (
              <div 
                key={sheet.id} 
                className={`relative group transition-all duration-200 ${
                  isActive ? 'z-10' : 'z-0'
                }`}
              >
                <div
                  className={`relative flex items-center px-4 py-2 pr-8 cursor-pointer transition-all duration-200 ${
                    isActive 
                      ? 'bg-blue-50 border-t-2 border-t-blue-600 text-blue-900' 
                      : 'bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => setActiveTab(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setActiveTab(index)
                    }
                  }}
                  tabIndex={0}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`${sheet.code} - ${sheet.title || 'Untitled'}`}
                  style={{ height: '52px' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Sheet Type Icon */}
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isActive ? 'bg-blue-600' : 'bg-gray-400'
                    }`}></div>
                    
                    {/* Sheet Info */}
                    <div className="flex flex-col min-w-0">
                      <span className={`font-mono text-sm font-medium ${
                        isActive ? 'text-blue-900' : 'text-gray-900'
                      }`}>
                        {sheet.code}
                      </span>
                      <span className={`text-xs truncate max-w-28 ${
                        isActive ? 'text-blue-700' : 'text-gray-500'
                      }`}>
                        {sheet.title || 'Untitled'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Close Button - Top Right Corner */}
                  <button
                    className={`absolute top-2 right-2 w-4 h-4 flex items-center justify-center rounded-full transition-all duration-200 ${
                      isActive 
                        ? 'hover:bg-red-100 text-blue-600 hover:text-red-600' 
                        : 'hover:bg-red-100 text-gray-400 hover:text-red-600'
                    } opacity-0 group-hover:opacity-100`}
                    onClick={(e) => closeTab(index, e)}
                    title={`Close ${sheet.code}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                
                {/* Active Tab Indicator */}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
                )}
              </div>
            )
          })}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2 px-4 border-l border-gray-200 bg-gray-50/50">
          <div className="flex items-center gap-1 bg-white rounded-md border border-gray-200 p-1">
            <button
              onClick={() => handleZoom(-1)}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-100 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4 text-gray-600" />
            </button>
            <span className="text-xs font-mono min-w-12 text-center text-gray-700 px-1">
              {Math.round(currentViewState.scale * 100)}%
            </span>
            <button
              onClick={() => handleZoom(1)}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-100 transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4 text-gray-600" />
            </button>
          </div>
          
          <div className="w-px h-6 bg-gray-300"></div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={fitToContainer}
              className="h-8 px-3 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 transition-all text-xs text-gray-600 hover:text-gray-900"
              title="Fit to Screen"
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      {/* Konva SVG Content */}
      <div className="relative overflow-hidden bg-white" style={{ flex: 1, minHeight: 0 }}>
        {currentSheet ? (
          svgImages[currentSheet.id] ? (
            <div ref={svgContainerRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
              {(() => {
                // Always use a reasonable size, with multiple fallback strategies
                let renderStageSize = stageSize
                
                if (stageSize.width < 100 || stageSize.height < 100) {
                  // Try to calculate from container if available
                  if (svgContainerRef.current) {
                    const rect = svgContainerRef.current.getBoundingClientRect()
                    if (rect.width > 100 && rect.height > 100) {
                      renderStageSize = { 
                        width: Math.floor(rect.width), 
                        height: Math.floor(rect.height) 
                      }
                      // Update the stage size for future renders
                      setStageSize(renderStageSize)
                    } else {
                      // Fallback to viewport-based calculation
                      renderStageSize = {
                        width: Math.floor(window.innerWidth * 0.8 - 40),
                        height: Math.floor(window.innerHeight - 200)
                      }
                    }
                  } else {
                    // Final fallback
                    renderStageSize = { 
                      width: Math.max(800, Math.floor(window.innerWidth * 0.8 - 40)), 
                      height: Math.max(600, Math.floor(window.innerHeight - 200))
                    }
                  }
                }
                
                if (!currentSheet || !svgImages[currentSheet.id]) {
                  return null
                }
                
                return (
                  <KonvaViewer
                    stageRef={stageRef}
                    stageSize={renderStageSize}
                    currentViewState={currentViewState}
                    handleWheel={handleWheel}
                    handleStageDragEnd={handleStageDragEnd}
                    svgImage={svgImages[currentSheet.id]}
                    svgDimensions={svgDimensions[currentSheet.id]}
                    columnsToRender={currentOverlayData.columns}
                    gridLinesToRender={currentOverlayData.gridLines}
                    measurementLinesToRender={currentOverlayData.measurementLines}
                    wallsToRender={currentOverlayData.walls}
                    nonStructuralWallsToRender={currentOverlayData.nonStructuralWalls}
                    elevationsToRender={currentOverlayData.elevations}
                  />
                )
              })()}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-sm text-gray-500 mt-1">Processing ...</p>
              </div>
            </div>
          )
        ) : null}
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 text-xs text-muted-foreground border-t bg-gray-50" style={{ height: '32px', flexShrink: 0 }}>
        <span>Sheet {safeActiveTab + 1} of {sheets.length}</span>
        <span>
          Position: {Math.round(currentViewState.translateX)}, {Math.round(currentViewState.translateY)} | 
          Scale: {Math.round(currentViewState.scale * 100)}%
        </span>
      </div>
    </div>
    </>
  )
}