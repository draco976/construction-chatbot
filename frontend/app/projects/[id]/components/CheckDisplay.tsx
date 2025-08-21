import React, { useState, useEffect, useRef } from 'react'
import { Badge } from "@/components/ui/badge"
import { Edit2, Check, X } from 'lucide-react'

interface Sheet {
  id: number
  code: string
  title?: string
  page?: number
  svgPath?: string
}

interface CheckDisplayProps {
  check: {
    id: number
    page: number
    boundingBox: string
    description?: string
  }
  rfiId: number
  rfiType?: string
}

export default function CheckDisplay({ check, rfiId, rfiType }: CheckDisplayProps) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [loading, setLoading] = useState(true)
  const [svgDimensions, setSvgDimensions] = useState<{width: number, height: number} | null>(null)
  const [transform, setTransform] = useState({ scale: 1, translateX: 0, translateY: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [initialZoomSet, setInitialZoomSet] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editedDescription, setEditedDescription] = useState(check.description || '')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    // Fetch sheet information for this page
    const fetchSheet = async () => {
      try {
        const response = await fetch(`http://localhost:8080/api/page?page=${check.page}`)
        if (response.ok) {
          const data = await response.json()
          if (data.sheet) {
            data.sheet.svgPath = data.sheet.svgPath.replace("//Users/harshvardhanagarwal/Desktop/ConcretePro/", "/Users/ashwin/Desktop/new_repo/ConcretePro/")          
        }
          setSheet(data.sheet)
        }
      } catch (error) {
        console.error('Error fetching sheet:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchSheet()
  }, [check.page])

  // Auto-zoom to bounding box when SVG dimensions are loaded
  useEffect(() => {
    if (svgDimensions && !initialZoomSet) {
      zoomToBoundingBox()
    }
  }, [svgDimensions, initialZoomSet])

  // Add wheel event listener to prevent page scrolling
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      
      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
      setTransform(prev => {
        const newScale = Math.min(Math.max(prev.scale * zoomFactor, 0.1), 5)
        
        // Zoom towards mouse position
        const scaleChange = newScale / prev.scale
        const newTranslateX = mouseX - (mouseX - prev.translateX) * scaleChange
        const newTranslateY = mouseY - (mouseY - prev.translateY) * scaleChange
        
        return {
          scale: newScale,
          translateX: newTranslateX,
          translateY: newTranslateY
        }
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // Parse the bounding box coordinates
  const parseBoundingBox = (bbox: string) => {
    try {
      return JSON.parse(bbox)
    } catch (error) {
      console.error('Error parsing bounding box:', error)
      return { x: 0, y: 0, width: 100, height: 100 }
    }
  }

  const bbox = parseBoundingBox(check.boundingBox)
  
  // Function to get SVG dimensions
  const getSvgDimensions = async (svgUrl: string) => {
    try {
      const response = await fetch(svgUrl)
      const svgText = await response.text()
      
      // Parse SVG to get viewBox or width/height
      const parser = new DOMParser()
      const svgDoc = parser.parseFromString(svgText, 'image/svg+xml')
      const svgElement = svgDoc.querySelector('svg')
      
      if (svgElement) {
        // Try to get dimensions from viewBox first
        const viewBox = svgElement.getAttribute('viewBox')
        if (viewBox) {
          const [, , width, height] = viewBox.split(' ').map(Number)
          return { width, height }
        }
        
        // Fallback to width/height attributes
        const width = parseFloat(svgElement.getAttribute('width') || '0')
        const height = parseFloat(svgElement.getAttribute('height') || '0')
        
        if (width && height) {
          return { width, height }
        }
      }
      
      return null
    } catch (error) {
      console.error('Error getting SVG dimensions:', error)
      return null
    }
  }
  
  // Calculate bounding box position as percentage of SVG dimensions
  const calculateBoundingBoxStyle = () => {
    if (!svgDimensions) {
      return {
        left: '10%',
        top: '10%', 
        width: '20%',
        height: '20%'
      }
    }
    
    // Calculate position and size as absolute pixels within the SVG coordinate system
    const left = bbox.x
    const top = bbox.y
    const width = bbox.width
    const height = bbox.height
    
    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`
    }
  }
  
  // Function to initially zoom into bounding box area
  const zoomToBoundingBox = () => {
    if (!svgDimensions || !containerRef.current) return
    
    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    const containerWidth = containerRect.width
    const containerHeight = containerRect.height
    
    // Calculate zoom level to fit the bounding box with padding
    const padding = 20 // small padding for tight framing
    const availableWidth = containerWidth - (padding * 2)
    const availableHeight = containerHeight - (padding * 2)
    
    const scaleX = availableWidth / bbox.width
    const scaleY = availableHeight / bbox.height
    const calculatedScale = Math.min(scaleX, scaleY)
    
    // Force a minimum zoom level to always zoom in significantly
    const scale = Math.max(calculatedScale, 3) // minimum 3x zoom, or higher if needed to fit bbox
    
    // Calculate translation to center the bounding box in the container
    const bboxCenterX = bbox.x + (bbox.width / 2)
    const bboxCenterY = bbox.y + (bbox.height / 2)
    
    // Convert SVG coordinates to image coordinates (considering object-contain)
    const svgAspect = svgDimensions.width / svgDimensions.height
    const containerAspect = containerWidth / containerHeight
    
    let imageWidth, imageHeight, imageOffsetX = 0, imageOffsetY = 0
    
    if (svgAspect > containerAspect) {
      // SVG is wider - image fills width
      imageWidth = containerWidth
      imageHeight = containerWidth / svgAspect
      imageOffsetY = (containerHeight - imageHeight) / 2
    } else {
      // SVG is taller - image fills height
      imageHeight = containerHeight
      imageWidth = containerHeight * svgAspect
      imageOffsetX = (containerWidth - imageWidth) / 2
    }
    
    // Calculate scale factor from SVG coordinates to image coordinates
    const imageScale = imageWidth / svgDimensions.width
    
    // Calculate center position in image coordinates
    const imageBboxCenterX = (bboxCenterX * imageScale) + imageOffsetX
    const imageBboxCenterY = (bboxCenterY * imageScale) + imageOffsetY
    
    // Calculate translation to center this point in the container
    const translateX = (containerWidth / 2) - (imageBboxCenterX * scale)
    const translateY = (containerHeight / 2) - (imageBboxCenterY * scale)
    
    setTransform({ scale, translateX, translateY })
    setInitialZoomSet(true)
  }
  
  // Handle mouse wheel for zooming (keeping this for TypeScript, but using addEventListener in useEffect)
  const handleWheel = (e: React.WheelEvent) => {
    // This is handled by the addEventListener in useEffect
  }
  
  // Handle mouse down for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - transform.translateX, y: e.clientY - transform.translateY })
  }
  
  // Handle mouse move for dragging
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    
    setTransform(prev => ({
      ...prev,
      translateX: e.clientX - dragStart.x,
      translateY: e.clientY - dragStart.y
    }))
  }
  
  // Handle mouse up to stop dragging
  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Handle description editing
  const handleEditDescription = () => {
    setIsEditingDescription(true)
    setEditedDescription(check.description || '')
  }

  const handleSaveDescription = async () => {
    if (isSaving) return
    
    setIsSaving(true)
    try {
      const response = await fetch(`http://localhost:8080/api/checks/${check.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: editedDescription
        })
      })

      if (response.ok) {
        // Update the local check object
        check.description = editedDescription
        setIsEditingDescription(false)
      } else {
        console.error('Failed to update description')
        alert('Failed to update description. Please try again.')
      }
    } catch (error) {
      console.error('Error updating description:', error)
      alert('Error updating description. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditingDescription(false)
    setEditedDescription(check.description || '')
  }
  
  // Calculate zoom and viewport for the PDF viewer
  const padding = 50 // Extra padding around the bounding box
  const viewportWidth = bbox.width + (padding * 2)
  const viewportHeight = bbox.height + (padding * 2)
  const centerX = bbox.x + (bbox.width / 2)
  const centerY = bbox.y + (bbox.height / 2)

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Sheet Information Header */}
      {sheet && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {sheet.code}{sheet.title ? ` - ${sheet.title}` : ''}
          </h3>
        </div>
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Side: Description and Information */}
        <div className="space-y-4">
          {/* Check Information */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Check ID:</span>
              <span className="text-gray-900">#{check.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Page:</span>
              <span className="text-gray-900">{check.page}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Sheet Code:</span>
              <span className="text-gray-900">{sheet?.code || 'Not available'}</span>
            </div>
          </div>

          {/* Description Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-sm text-gray-900">Description</h4>
              {!isEditingDescription && (
                <button
                  onClick={handleEditDescription}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                  title="Edit description"
                >
                  <Edit2 className="h-3 w-3 text-gray-500" />
                </button>
              )}
            </div>
            
            {isEditingDescription ? (
              <div className="space-y-2">
                <textarea
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  className="w-full p-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[80px]"
                  placeholder="Enter description..."
                  disabled={isSaving}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveDescription}
                    disabled={isSaving}
                    className="flex items-center gap-1 px-3 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check className="h-3 w-3" />
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    className="flex items-center gap-1 px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">
                {check.description || 'No description provided'}
              </p>
            )}
          </div>
          
          {/* Action Button */}
          <div className="flex gap-2 pt-2">
            <button 
              className={`text-xs px-3 py-1 rounded border transition-colors ${
                sheet?.svgPath 
                  ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200' 
                  : 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
              }`}
              disabled={!sheet?.svgPath}
              onClick={() => {
                if (sheet?.svgPath) {
                  // Open the SVG through the API endpoint with CORS headers
                  const svgUrl = sheet.svgPath.includes('/documents/') 
                    ? (() => {
                        const pathParts = sheet.svgPath.split('/documents/')[1].split('/')
                        if (pathParts.length >= 2) {
                          const projectName = pathParts[0]
                          const filename = pathParts.slice(1).join('/')
                          return `http://localhost:8080/api/svg/${projectName}/${filename}`
                        }
                        return `http://localhost:8080${sheet.svgPath}`
                      })()
                    : sheet.svgPath;
                  window.open(svgUrl, '_blank')
                }
              }}
            >
              {sheet?.svgPath ? 'View Full Sheet' : 'Sheet Not Available'}
            </button>
          </div>
        </div>

        {/* Right Side: SVG/PDF Viewer */}
        <div className="space-y-2">
          {/* SVG/PDF Display with Bounding Box Overlay */}
          <div 
            ref={containerRef}
            className="relative bg-gray-100 rounded-lg overflow-hidden aspect-[4/3] cursor-grab select-none"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mx-auto mb-2"></div>
                  <div className="text-sm">Loading sheet data...</div>
                </div>
              </div>
            ) : sheet?.svgPath ? (
              /* SVG Display */
              <div className="relative w-full h-full">
                {/* Container for both SVG and bounding box with shared transform */}
                <div 
                  className="absolute inset-0"
                  style={{
                    transform: `scale(${transform.scale}) translate(${transform.translateX / transform.scale}px, ${transform.translateY / transform.scale}px)`,
                    transformOrigin: '0 0'
                  }}
                >
                  <img 
                    src={sheet.svgPath.includes('/documents/') 
                      ? (() => {
                          // Extract project name and filename from path like '/documents/1755303713426-project_svgs/page_126.svg'
                          const pathParts = sheet.svgPath.split('/documents/')[1].split('/')
                          if (pathParts.length >= 2) {
                            const projectName = pathParts[0]
                            const filename = pathParts.slice(1).join('/')
                            return `http://localhost:8080/api/svg/${projectName}/${filename}`
                          }
                          return `http://localhost:8080${sheet.svgPath}`
                        })()
                      : sheet.svgPath
                    }
                    alt={`Sheet ${check.page}`}
                    className="w-full h-full object-contain pointer-events-none select-none"
                    style={{ 
                      imageRendering: 'crisp-edges',
                      maxWidth: 'none',
                      maxHeight: 'none'
                    }}
                    onLoad={async (e) => {
                      // Get SVG dimensions when image loads
                      const svgUrl = e.currentTarget.src
                      const dimensions = await getSvgDimensions(svgUrl)
                      if (dimensions) {
                        setSvgDimensions(dimensions)
                        console.log('SVG dimensions:', dimensions)
                        console.log('Bounding box:', bbox)
                      }
                    }}
                    onError={(e) => {
                      console.error('Failed to load SVG:', e.currentTarget.src);
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  
                  {/* Fallback when image fails to load */}
                  <div className="hidden absolute inset-0 flex items-center justify-center text-gray-400">
                    <div className="text-center">
                      <div className="text-sm font-medium">Failed to load SVG</div>
                      <div className="text-xs text-gray-500 mt-1">Page {check.page}</div>
                      <div className="text-xs mt-1 break-all max-w-xs">
                        Path: {sheet.svgPath}
                      </div>
                    </div>
                  </div>
                  
                  {/* Bounding Box Overlay - now in the same coordinate space as SVG */}
                  {svgDimensions && (() => {
                    // Check if this is a wall RFI type
                    const isWallType = rfiType?.includes('wall') || rfiType?.includes('Wall')
                    
                    const originalWidth = (bbox.width / svgDimensions.width) * 100
                    const originalHeight = (bbox.height / svgDimensions.height) * 100
                    const originalLeft = (bbox.x / svgDimensions.width) * 100
                    const originalTop = (bbox.y / svgDimensions.height) * 100
                    
                    let scaledWidth, scaledHeight
                    
                    if (isWallType) {
                      // For walls, scale differently based on which dimension is longer
                      const isWidthLonger = originalWidth > originalHeight
                      
                      if (isWidthLonger) {
                        // Width is longer - make it much smaller (30%), height normal scale (60%)
                        scaledWidth = originalWidth * 0.3
                        scaledHeight = originalHeight * 0.6
                      } else {
                        // Height is longer - make it much smaller (30%), width normal scale (60%)
                        scaledWidth = originalWidth * 0.6
                        scaledHeight = originalHeight * 0.3
                      }
                    } else {
                      // Non-wall types keep original size
                      scaledWidth = originalWidth
                      scaledHeight = originalHeight
                    }
                    
                    // Center the scaled bounding box
                    const scaledLeft = originalLeft + (originalWidth - scaledWidth) / 2
                    const scaledTop = originalTop + (originalHeight - scaledHeight) / 2
                    
                    return (
                      <div 
                        className="absolute border-2 border-red-500 bg-red-500 bg-opacity-20 rounded pointer-events-none"
                        style={{
                          left: `${scaledLeft}%`,
                          top: `${scaledTop}%`,
                          width: `${scaledWidth}%`,
                          height: `${scaledHeight}%`
                        }}
                      >
                        <div className="absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 rounded whitespace-nowrap">
                          Target{isWallType ? ' (Wall)' : ''}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            ) : (
              /* Placeholder when no sheet data */
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <div className="text-sm font-medium">Page {check.page}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {sheet ? 'No SVG path available' : 'Sheet data not found'}
                  </div>
                  <div className="text-xs">Size: {bbox.width.toFixed(1)} × {bbox.height.toFixed(1)}</div>
                  {/* Placeholder bounding box visualization */}
                  <div 
                    className="mt-4 mx-auto border-2 border-red-500 bg-red-50 bg-opacity-50 rounded"
                    style={{
                      width: '60px',
                      height: '40px'
                    }}
                  >
                    <div className="text-xs text-red-600 mt-1">Area</div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Coordinates overlay */}
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
              x: {bbox.x.toFixed(1)}, y: {bbox.y.toFixed(1)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}