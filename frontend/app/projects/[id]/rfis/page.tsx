"use client"

import { ArrowLeft, FileText, Upload, GitCompare, ChevronDown, ChevronUp, Edit2, Check, X, Home, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { useParams } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"
import CheckDisplay from "../components/CheckDisplay"

interface Check {
  id: number
  page: number
  boundingBox: string
  description?: string
  rfiId: number
}

interface Sheet {
  id: number
  code: string
  title?: string
  page?: number
}

interface RFI {
  id: number
  description: string
  type?: string
  imagePath: string
  createdAt: string
  checks: Check[]
}

interface OriginalImage {
  id: number
  version: string
  versionCode: string
  imagePath: string
  description: string
  createdAt: string
}

// Associated Checks Dropdown Component
function AssociatedChecksDropdown({ rfi }: { rfi: RFI }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="space-y-4">
      {/* Dropdown Header */}
      <div className="border-b pb-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-full text-left"
        >
          <h4 className="text-sm font-medium text-gray-900">
            Associated Checks ({rfi.checks.length})
          </h4>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          )}
        </button>
      </div>

      {/* Dropdown Content - Show All Checks */}
      {isOpen && (
        <div className="space-y-3">
          {rfi.checks.map(check => (
            <CheckDisplay 
              key={check.id}
              check={check} 
              rfiId={rfi.id}
              rfiType={rfi.type}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface Project {
  id: number
  name: string
  date: string
}

interface VersionClash {
  id: number
  sheetCode: string
  title: string
  description: string
  overlayImagePath: string
  originalImages: OriginalImage[]
  createdAt: string
  status: "Active" | "Resolved" | "Under Review"
  priority: "High" | "Medium" | "Low"
  affectedVersions: string[]
  clashType: "Dimensional" | "Structural" | "MEP" | "Architectural" | "Other"
}

const mockVersionClashes: VersionClash[] = [
  {
    id: 1,
    sheetCode: "S-1.1",
    title: "Wall extended for room 1302 on Floor 1 Area A in the new DD version",
    description: "Significant layout differences detected between CD and DD versions in room E102. The wall has been extended by 2 feet in the DD version, affecting the room layout and dimensions.",
    overlayImagePath: "/overlay/a.png",
    originalImages: [
      {
        id: 1,
        version: "90% CD",
        versionCode: "CD-2025-001",
        imagePath: "/overlay/a.png",
        description: "Original CD version showing initial room layout",
        createdAt: "2025-06-10T14:20:00Z"
      },
      {
        id: 2,
        version: "90% DD",
        versionCode: "DD-2025-002", 
        imagePath: "/overlay/main.png",
        description: "Updated DD version with modified wall positions",
        createdAt: "2025-06-15T10:30:00Z"
      }
    ],
    createdAt: "2025-06-15T10:30:00Z",
    status: "Active",
    priority: "High",
    affectedVersions: ["90% CD", "90% DD"],
    clashType: "Architectural"
  }
]


export default function RFIPage() {
  const params = useParams()
  const projectId = params.id as string
  
  const [project, setProject] = useState<Project | null>(null)
  const [rfis, setRfis] = useState<RFI[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>("all")
  const [exportingRfiId, setExportingRfiId] = useState<number | null>(null)
  const [editingRfiId, setEditingRfiId] = useState<number | null>(null)
  const [editedRfiDescription, setEditedRfiDescription] = useState<string>('')
  const [isSavingRfi, setIsSavingRfi] = useState(false)
  const [sheetCodes, setSheetCodes] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    if (projectId) {
      fetchProject()
      fetchRFIs()
    }
  }, [projectId])

  const fetchProject = async () => {
    try {
      const response = await fetch(`http://localhost:8080/api/projects/${projectId}`)
      if (response.ok) {
        const data = await response.json()
        setProject(data)  // API returns project data directly
      }
    } catch (error) {
      console.error('Error fetching project:', error)
    }
  }

  const fetchRFIs = async () => {
    try {
      setLoading(true)
      setError(null)
      
      // Fetch RFIs from server API
      const response = await fetch(`http://localhost:8080/api/rfis?projectId=${projectId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch RFIs')
      }
      
      const data = await response.json()
      const fetchedRfis = data.rfis || []
      setRfis(fetchedRfis)
      
      // Extract unique page numbers from all checks
      const pageNumbers = new Set<number>()
      fetchedRfis.forEach((rfi: RFI) => {
        rfi.checks.forEach((check: Check) => {
          pageNumbers.add(check.page)
        })
      })
      
      // Fetch sheet codes for all unique pages
      const newSheetCodes = new Map<number, string>()
      await Promise.all(
        Array.from(pageNumbers).map(async (page) => {
          try {
            const sheetResponse = await fetch(`http://localhost:8080/api/page?page=${page}`)
            if (sheetResponse.ok) {
              const sheetData = await sheetResponse.json()
              if (sheetData.sheet?.code) {
                newSheetCodes.set(page, sheetData.sheet.code)
              }
            }
          } catch (error) {
            console.error(`Error fetching sheet for page ${page}:`, error)
          }
        })
      )
      
      setSheetCodes(newSheetCodes)
    } catch (err) {
      console.error('Error fetching RFIs:', err)
      setError('Failed to load RFIs')
    } finally {
      setLoading(false)
    }
  }

  // Handle RFI description editing
  const handleEditRfiDescription = (rfi: RFI) => {
    setEditingRfiId(rfi.id)
    // Set the cleaned description for editing (without title prefix)
    setEditedRfiDescription(cleanRfiDescription(rfi.description))
  }

  const handleSaveRfiDescription = async (rfiId: number) => {
    if (isSavingRfi) return
    
    setIsSavingRfi(true)
    try {
      // Find the original RFI to get the title part
      const originalRfi = rfis.find(rfi => rfi.id === rfiId)
      if (!originalRfi) return
      
      // Extract the title part from the original description
      const originalParts = originalRfi.description.split('\n\n')
      const titlePart = originalParts[0] // Keep the title
      
      // Combine title with new description
      const fullDescription = `${titlePart}\n\n${editedRfiDescription}`
      
      const response = await fetch(`http://localhost:8080/api/rfis/${rfiId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: fullDescription
        })
      })

      if (response.ok) {
        // Update the local RFI object
        setRfis(prev => prev.map(rfi => 
          rfi.id === rfiId 
            ? { ...rfi, description: fullDescription }
            : rfi
        ))
        setEditingRfiId(null)
      } else {
        console.error('Failed to update RFI description')
        alert('Failed to update RFI description. Please try again.')
      }
    } catch (error) {
      console.error('Error updating RFI description:', error)
      alert('Error updating RFI description. Please try again.')
    } finally {
      setIsSavingRfi(false)
    }
  }

  const handleCancelRfiEdit = () => {
    setEditingRfiId(null)
    setEditedRfiDescription('')
  }

  // Helper function to clean RFI description by removing title prefix
  const cleanRfiDescription = (description: string) => {
    if (!description) return ''
    
    // Split by double newline to separate title from description
    const parts = description.split('\n\n')
    
    // If there are multiple parts, return everything after the first part (which is the title)
    if (parts.length > 1) {
      return parts.slice(1).join('\n\n').trim()
    }
    
    // If no double newline, check for single newline after title patterns
    const lines = description.split('\n')
    if (lines.length > 1) {
      const firstLine = lines[0].trim()
      // Check if first line looks like a title (contains patterns like "Page", "#", "Level", etc.)
      if (firstLine.includes('Page') || firstLine.includes('#') || firstLine.includes('Level') || firstLine.includes(' - ')) {
        return lines.slice(1).join('\n').trim()
      }
    }
    
    // Return original description if no title pattern found
    return description.trim()
  }

  // Filter RFIs based on active tab and sort by ID
  const getFilteredRfis = () => {
    let filtered
    if (activeTab === "all") {
      filtered = rfis
    } else if (activeTab === "columns") {
      // Columns tab includes both position and mismatch column issues
      filtered = rfis.filter(rfi => 
        rfi.type === "unmatched_column" || 
        rfi.type === "unmatched_overlay_column_architectural" ||
        rfi.type === "unmatched_overlay_column_structural"
      )
    } else {
      filtered = rfis.filter(rfi => rfi.type === activeTab)
    }
    // Sort by ID in ascending order
    return filtered.sort((a, b) => a.id - b.id)
  }

  // Get count for each RFI type
  const getRfiCount = (type: string) => {
    if (type === "all") {
      return rfis.length
    } else if (type === "columns") {
      // Columns count includes both position and mismatch column issues
      return rfis.filter(rfi => 
        rfi.type === "unmatched_column" || 
        rfi.type === "unmatched_overlay_column_architectural" ||
        rfi.type === "unmatched_overlay_column_structural"
      ).length
    }
    return rfis.filter(rfi => rfi.type === type).length
  }

  // Convert RFI type to display name
  const getRfiTypeDisplayName = (type: string) => {
    const typeNames = {
      'columns': 'Column',
      'unmatched_column': 'Column (Position)',
      'unmatched_overlay_column_architectural': 'Column (Overlay)',
      'unmatched_wall': 'Wall (Position)',
      'unmatched_overlay_column_structural': 'Wall (Overlay)',
      'slab': 'Concrete Slab'
    }
    return typeNames[type as keyof typeof typeNames] || type
  }

  // Get explanation for each RFI type
  const getRfiTypeExplanation = (type: string) => {
    const explanations = {
      'slab': {
        title: 'Concrete Slab Depression Analysis Process',
        steps: [
          '1. Identify concrete slab depressions from slab plans',
          '2. Extract grid references and dimensions from slab drawings',
          '3. Flag depressions without clear dimensions or grid references',
        ],
        highlight: 'These RFIs identify locations where slab depression positioning lacks proper dimensional context or grid references, requiring clarification for accurate construction.'
      },
      'unmatched_column': {
        title: 'Column Position Detection Process',
        steps: [
          '1. Extract column positions and grid lines from slab plans',
          '2. Check column positions against floors beneath',
          '3. Check column positions between structural and architectural plans',
          '4. Flag columns that do not have exact position information',
        ]
      },
      'unmatched_overlay_column_architectural': {
        title: 'Column Overlay Detection Process',
        steps: [
          '1. Overlay structural and architectural plans for alignment analysis',
          '2. Apply coordinate transformation to align plans properly',
          '3. Identify columns that don\'t align between structural and architectural overlays'
        ]
      },
      'unmatched_wall': {
        title: 'Wall Position Detection Process',
        steps: [
          '1. Extract wall positions and grid lines from slab plans',
          '2. Check wall positions against floors beneath',
          '3. Check wall positions between structural and architectural plans',
          '4. Flag walls that do not have exact position information',
        ]
      },
      'wall_overlay': {
        title: 'Wall Overlay Detection Process',
        steps: [
          '1. Overlay structural and architectural plans for wall alignment analysis',
          '2. Apply coordinate transformation to align wall plans properly',
          '3. Identify walls that don\'t align between structural and architectural overlays',
        ]
      },
      'enlarged_plans': {
        title: 'Enlarged Plans Analysis Process',
        steps: [
          '1. Identify areas requiring detailed examination from standard plans',
          '2. Extract enlarged plan sections from drawing sheets',
          '3. Cross-reference enlarged details with corresponding standard plan locations',
          '4. Verify dimensional accuracy and detail consistency between plan scales',
          '5. Flag discrepancies between enlarged details and standard plan information',
        ]
      },
      'cross_section_view': {
        title: 'Cross-Section View Analysis Process',
        steps: [
          '1. Extract cross-sectional drawings from architectural and structural sheets',
          '2. Identify section cut lines and their corresponding plan locations',
          '3. Analyze vertical relationships between floors, beams, and structural elements',
          '4. Compare cross-section details with plan view information for consistency',
          '5. Verify elevation dimensions and structural member sizes',
          '6. Detect conflicts between cross-section views and plan drawings',
        ]
      }
    }
    return explanations[type as keyof typeof explanations]
  }

  const filteredRfis = getFilteredRfis()

  const handleExportToProcore = async (rfiId: number) => {
    try {
      // Set loading state for this specific RFI
      setExportingRfiId(rfiId)
      
      // Find the RFI data
      const rfi = rfis.find(r => r.id === rfiId)
      if (!rfi) {
        alert('RFI not found')
        return
      }
      
      console.log(`Exporting RFI ${rfiId} to Procore`)
      
      // Prepare the data for Procore
      const procoreData = {
        title: `RFI #${rfi.id} - ${rfi.type || 'Construction Issue'}`,
        description: cleanRfiDescription(rfi.description),
        image_path: rfi.imagePath ? `../documents${rfi.imagePath}` : null
      }
      
      console.log('Sending to Procore:', procoreData)
      
      // Call the Procore API endpoint
      const response = await fetch('http://localhost:8080/api/procore/create-rfi', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for session
        body: JSON.stringify(procoreData)
      })
      
      if (response.status === 401) {
        // User is not authenticated - redirect to Procore OAuth
        const confirmed = confirm(
          '🔐 You need to login to Procore first to export RFIs.\n\n' +
          'Click OK to login to Procore, then try exporting again.'
        )
        
        if (confirmed) {
          // Get the OAuth login URL
          const loginResponse = await fetch('http://localhost:8080/procore/auth/login', {
            credentials: 'include'
          })
          
          if (loginResponse.ok) {
            const loginData = await loginResponse.json()
            // Open Procore OAuth in a new window
            const authWindow = window.open(
              loginData.redirect_url, 
              'procore-auth', 
              'width=600,height=700,scrollbars=yes'
            )
            
            // Monitor the auth window
            const checkAuth = setInterval(() => {
              try {
                if (authWindow?.closed) {
                  clearInterval(checkAuth)
                  alert('Authentication completed! Please try exporting the RFI again.')
                }
              } catch (e) {
                // Ignore cross-origin errors
              }
            }, 1000)
          } else {
            alert('❌ Failed to start Procore authentication')
          }
        }
        return
      }
      
      if (response.ok) {
        const result = await response.json()
        console.log('Procore RFI created:', result)
        
        alert(
          `✅ RFI successfully exported to Procore!\n\n` +
          `RFI ID: ${result.rfi_id}\n` +
          `RFI Number: ${result.rfi_number}\n` +
          `Status: ${result.status}\n` +
          `${result.attachment_uploaded ? '📎 Image attached' : ''}`
        )
      } else {
        const error = await response.json()
        console.error('Procore export failed:', error)
        alert(`❌ Failed to export to Procore: ${error.detail || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error exporting to Procore:', error)
      alert(`❌ Error exporting to Procore: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      // Clear loading state
      setExportingRfiId(null)
    }
  }

  return (
    <SidebarInset>
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
            <div className="flex items-center justify-center w-8 h-8 bg-red-100 rounded-lg">
              <FileText className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Project Issues</h1>
              <p className="text-xs text-gray-500">
                View and manage project RFIs
              </p>
            </div>
          </div>
        </nav>
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-8 p-8 bg-gradient-to-br from-blue-50/30 via-purple-50/20 to-pink-50/30 min-h-screen">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-8 h-16 bg-white/60 backdrop-blur-sm rounded-2xl border border-white/40 shadow-lg">
            <TabsTrigger 
              value="all" 
              className="flex items-center gap-2 h-12 mx-1 rounded-xl text-sm font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300"
            >
              <FileText className="h-4 w-4" />
              All RFIs ({getRfiCount("all")})
            </TabsTrigger>
            <TabsTrigger 
              value="columns" 
              className="flex items-center gap-2 h-12 mx-1 rounded-xl text-sm font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300"
            >
              Columns ({getRfiCount("columns")})
            </TabsTrigger>
            <TabsTrigger 
              value="unmatched_wall" 
              className="flex items-center gap-2 h-12 mx-1 rounded-xl text-sm font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300"
            >
              Walls ({getRfiCount("unmatched_wall")})
            </TabsTrigger>
            {/* <TabsTrigger 
              value="wall_overlay" 
              className="flex items-center gap-2 h-12 mx-1 rounded-xl text-sm font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300"
            >
              Wall (Overlay) (0)
            </TabsTrigger> */}

            <TabsTrigger 
              value="slab" 
              className="flex items-center gap-2 h-12 mx-1 rounded-xl text-sm font-semibold data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all duration-300"
            >
              Slabs ({getRfiCount("slab")})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-red-500 mb-4" />
                <h3 className="text-lg font-medium mb-2">Error Loading RFIs</h3>
                <p className="text-muted-foreground mb-4">{error}</p>
                <Button onClick={fetchRFIs} variant="outline">
                  Try Again
                </Button>
              </div>
            ) : filteredRfis.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium mb-2">No RFIs Found</h3>
                <p className="text-muted-foreground">
                  {activeTab === "all" 
                    ? "This project doesn't have any RFI records yet."
                    : `No ${getRfiTypeDisplayName(activeTab)} RFIs found.`
                  }
                </p>
              </div>
            ) : (
              filteredRfis.map((rfi) => (
                <Card key={rfi.id} className="w-full overflow-hidden hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg font-semibold">
                          RFI #{rfi.id}
                        </CardTitle>
                        <div className="flex gap-2 mt-2">
                          {rfi.checks.slice(0, 1).map(check => (
                            <Badge key={check.id} variant="outline" className="text-xs">
                              {sheetCodes.get(check.page) || `Page ${check.page}`}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Button
                        onClick={() => handleExportToProcore(rfi.id)}
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2 ml-4"
                        disabled={exportingRfiId === rfi.id}
                      >
                        {exportingRfiId === rfi.id ? (
                          <>
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Exporting...
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4" />
                            Export to Procore
                          </>
                        )}
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-6">
                    {/* Main RFI Content */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* RFI Image */}
                      <div className="lg:col-span-1">
                        <div className="aspect-[2/1] bg-gray-100 rounded-lg overflow-hidden">
                          <img
                            src={rfi.imagePath}
                            alt={`RFI ${rfi.id}`}
                            className="w-full h-full object-contain hover:scale-105 transition-transform cursor-pointer"
                            onClick={() => window.open(rfi.imagePath, '_blank')}
                          />
                        </div>
                      </div>

                      {/* RFI Description */}
                      <div className="lg:col-span-2">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-medium text-gray-900">Description</h3>
                          {editingRfiId !== rfi.id && (
                            <button
                              onClick={() => handleEditRfiDescription(rfi)}
                              className="p-1 hover:bg-gray-100 rounded transition-colors"
                              title="Edit description"
                            >
                              <Edit2 className="h-3 w-3 text-gray-500" />
                            </button>
                          )}
                        </div>
                        
                        {editingRfiId === rfi.id ? (
                          <div className="space-y-2 mb-4">
                            <textarea
                              value={editedRfiDescription}
                              onChange={(e) => setEditedRfiDescription(e.target.value)}
                              className="w-full p-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[80px]"
                              placeholder="Enter description..."
                              disabled={isSavingRfi}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSaveRfiDescription(rfi.id)}
                                disabled={isSavingRfi}
                                className="flex items-center gap-1 px-3 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <Check className="h-3 w-3" />
                                {isSavingRfi ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={handleCancelRfiEdit}
                                disabled={isSavingRfi}
                                className="flex items-center gap-1 px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 disabled:opacity-50"
                              >
                                <X className="h-3 w-3" />
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-600 leading-relaxed mb-4">
                            {cleanRfiDescription(rfi.description)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Associated Checks Dropdown */}
                    {rfi.checks.length > 0 && <AssociatedChecksDropdown rfi={rfi} />}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Other RFI type tabs - all use the same format as "all" tab but filtered */}
          {["columns", "unmatched_wall", "wall_overlay", "slab", "enlarged_plans", "cross_section_view"].map((tabType) => (
            <TabsContent key={tabType} value={tabType} className="space-y-6">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <FileText className="h-12 w-12 text-red-500 mb-4" />
                  <h3 className="text-lg font-medium mb-2">Error Loading RFIs</h3>
                  <p className="text-muted-foreground mb-4">{error}</p>
                  <Button onClick={fetchRFIs} variant="outline">
                    Try Again
                  </Button>
                </div>
              ) : (
                <>
                  {/* Information Block */}
                  {/* {(() => {
                    const explanation = getRfiTypeExplanation(tabType)
                    if (explanation) {
                      return (
                        <Card className="mb-6 bg-blue-50/50 border-blue-200">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-lg font-semibold text-blue-800">
                              {explanation.title}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {explanation.steps.map((step, index) => (
                                <div key={index} className="text-sm text-blue-700 leading-relaxed">
                                  {step}
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )
                    }
                    return null
                  })()} */}

                  {filteredRfis.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <FileText className="h-12 w-12 text-gray-300 mb-4" />
                      <h3 className="text-lg font-medium mb-2">No RFIs Found</h3>
                      <p className="text-muted-foreground">
                        No {getRfiTypeDisplayName(tabType)} RFIs found.
                      </p>
                    </div>
                  ) : (
                    filteredRfis.map((rfi) => (
                      <Card key={rfi.id} className="w-full overflow-hidden hover:shadow-lg transition-shadow">
                        <CardHeader className="pb-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-lg font-semibold">
                                RFI #{rfi.id}
                              </CardTitle>
                              <div className="flex gap-2 mt-2">
                                {rfi.checks.slice(0, 1).map(check => (
                                  <Badge key={check.id} variant="outline" className="text-xs">
                                    {sheetCodes.get(check.page) || `Page ${check.page}`}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <Button
                              onClick={() => handleExportToProcore(rfi.id)}
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-2 ml-4"
                              disabled={exportingRfiId === rfi.id}
                            >
                              {exportingRfiId === rfi.id ? (
                                <>
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                  Exporting...
                                </>
                              ) : (
                                <>
                                  <Upload className="h-4 w-4" />
                                  Export to Procore
                                </>
                              )}
                            </Button>
                          </div>
                        </CardHeader>

                        <CardContent className="space-y-6">
                          {/* Main RFI Content */}
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* RFI Image */}
                            <div className="lg:col-span-1">
                              <div className="aspect-[2/1] bg-gray-100 rounded-lg overflow-hidden">
                                <img
                                  src={rfi.imagePath}
                                  alt={`RFI ${rfi.id}`}
                                  className="w-full h-full object-contain hover:scale-105 transition-transform cursor-pointer"
                                  onClick={() => window.open(rfi.imagePath, '_blank')}
                                />
                              </div>
                            </div>

                            {/* RFI Description */}
                            <div className="lg:col-span-2">
                              <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-medium text-gray-900">Description</h3>
                                {editingRfiId !== rfi.id && (
                                  <button
                                    onClick={() => handleEditRfiDescription(rfi)}
                                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                                    title="Edit description"
                                  >
                                    <Edit2 className="h-3 w-3 text-gray-500" />
                                  </button>
                                )}
                              </div>
                              
                              {editingRfiId === rfi.id ? (
                                <div className="space-y-2 mb-4">
                                  <textarea
                                    value={editedRfiDescription}
                                    onChange={(e) => setEditedRfiDescription(e.target.value)}
                                    className="w-full p-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[80px]"
                                    placeholder="Enter description..."
                                    disabled={isSavingRfi}
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSaveRfiDescription(rfi.id)}
                                      disabled={isSavingRfi}
                                      className="flex items-center gap-1 px-3 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      <Check className="h-3 w-3" />
                                      {isSavingRfi ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                      onClick={handleCancelRfiEdit}
                                      disabled={isSavingRfi}
                                      className="flex items-center gap-1 px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 disabled:opacity-50"
                                    >
                                      <X className="h-3 w-3" />
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-gray-600 leading-relaxed mb-4">
                                  {cleanRfiDescription(rfi.description)}
                                </p>
                              )}
                              
                              {/* Additional Information */}
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-500">Created:</span>
                                  <span className="text-gray-900">{new Date(rfi.createdAt).toLocaleDateString()}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Associated Checks Dropdown */}
                          {rfi.checks.length > 0 && <AssociatedChecksDropdown rfi={rfi} />}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </>
              )}
            </TabsContent>
          ))}

          <TabsContent value="version-differences" className="space-y-6">
            {mockVersionClashes.map((clash) => (
              <Card key={clash.id} className="w-full overflow-hidden hover:shadow-lg transition-shadow">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <CardTitle className="text-lg font-semibold">
                          Version Clash #{clash.id}: {clash.title}
                        </CardTitle>
                        <Badge variant="secondary" className="text-xs font-mono">
                          {clash.sheetCode}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6">
                  {/* Main Clash Content */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Overlay Image */}
                    <div className="lg:col-span-1">
                      <div className="aspect-[2/1] bg-gray-100 rounded-lg overflow-hidden">
                        <img
                          src={clash.overlayImagePath}
                          alt={clash.title}
                          className="w-full h-full object-contain hover:scale-105 transition-transform cursor-pointer"
                          onClick={() => window.open(clash.overlayImagePath, '_blank')}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2 text-center">
                        Overlay showing differences between versions
                      </p>
                    </div>

                    {/* Clash Description */}
                    <div className="lg:col-span-2">
                      <h3 className="text-sm font-medium text-gray-900 mb-2">Description</h3>
                      <p className="text-sm text-gray-600 leading-relaxed mb-4">
                        {clash.description}
                      </p>
                      
                      {/* Version Information */}
                      <div className="space-y-4">
                        <div>
                          <span className="font-medium text-gray-900 text-sm">Affected Versions:</span>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {clash.originalImages.map((original, idx) => (
                              <div key={idx} className="bg-gray-50 rounded-lg p-3 border">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="text-xs font-mono">
                                    {original.version}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs">
                                    {original.versionCode}
                                  </Badge>
                                </div>
                                <p className="text-xs text-gray-600">
                                  {new Date(original.createdAt).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </SidebarInset>
  )
}
