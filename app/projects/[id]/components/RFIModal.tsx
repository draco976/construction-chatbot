"use client"

import { useState, useEffect } from "react"
import { X, AlertTriangle, FileText, ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import CheckDisplay from "./CheckDisplay"

interface Check {
  id: number
  page: number
  boundingBox: string
  description?: string
}

interface RFI {
  id: number
  title: string
  description: string
  type?: string
  imagePath: string
  createdAt: string
  checks: Check[]
}

interface RFIModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
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
              associatedChecks={rfi.checks}
              showAssociatedChecks={true}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function RFIModal({ isOpen, onClose, projectId }: RFIModalProps) {
  const [rfis, setRfis] = useState<RFI[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOverlayMode, setIsOverlayMode] = useState(false)
  const [activeTab, setActiveTab] = useState<string>("all")
  
  // Hardcoded IDs to be removed in overlay mode
  const hiddenRfiIds = [1140, 1141, 1143, 1144, 1124, 1125, 1122, 1123, 1120, 1119, 1121, 1100, 1059, 1014, 1015] // Customize these IDs as needed

  useEffect(() => {
    if (isOpen && projectId) {
      fetchRFIs()
    }
  }, [isOpen, projectId])

  const fetchRFIs = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(`/api/rfis?projectId=${projectId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch RFIs')
      }
      
      const data = await response.json()
      setRfis(data.rfis || [])
    } catch (err) {
      console.error('Error fetching RFIs:', err)
      setError('Failed to load RFIs')
    } finally {
      setLoading(false)
    }
  }

  // Filter RFIs based on overlay mode and active tab
  const getFilteredRfis = () => {
    let filtered = isOverlayMode 
      ? rfis.filter(rfi => !hiddenRfiIds.includes(rfi.id))
      : rfis

    if (activeTab !== "all") {
      filtered = filtered.filter(rfi => rfi.type === activeTab)
    }

    return filtered
  }

  const filteredRfis = getFilteredRfis()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <h2 className="text-xl font-semibold">Request for Information (RFI)</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant={isOverlayMode ? "default" : "outline"} 
              size="sm" 
              onClick={() => setIsOverlayMode(!isOverlayMode)}
            >
              Overlay
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
              <h3 className="text-lg font-medium mb-2">Error Loading RFIs</h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={fetchRFIs} variant="outline">
                Try Again
              </Button>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unmatched_column">Column (Position)</TabsTrigger>
                <TabsTrigger value="column_overlay">Column (Overlay)</TabsTrigger>
                <TabsTrigger value="unmatched_wall">Wall (Position)</TabsTrigger>
                <TabsTrigger value="wall_overlay">Wall (Overlay)</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-6">
                {filteredRfis.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <FileText className="h-12 w-12 text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium mb-2">No RFIs Found</h3>
                    <p className="text-muted-foreground">
                      This project doesn't have any RFI records yet.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-medium">
                        Found {filteredRfis.length} RFI{filteredRfis.length !== 1 ? 's' : ''}
                        {isOverlayMode && ` (${rfis.length - filteredRfis.length} hidden in overlay mode)`}
                      </h3>
                    </div>
                    
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {filteredRfis.map((rfi) => (
                        <Card key={rfi.id} className="overflow-hidden">
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <CardTitle className="text-sm font-medium">
                                  {rfi.checks.length > 0 ? rfi.checks.map(check => `Page ${check.page}`).join(", ") : "No pages"}
                                </CardTitle>
                                <CardDescription className="text-xs mt-1">
                                  {rfi.type || 'No type specified'}
                                </CardDescription>
                              </div>
                              <div className="text-xs text-muted-foreground ml-2">
                                ID: {rfi.id}
                              </div>
                            </div>
                          </CardHeader>
                          
                          <CardContent className="pt-0">
                            {/* RFI Image */}
                            <div className="mb-3 bg-gray-100 rounded-md overflow-hidden">
                              <img
                                src={`./${rfi.imagePath}`}
                                alt={`RFI ${rfi.id}`}
                                className="w-full h-32 object-cover hover:h-40 transition-all duration-200 cursor-pointer"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  target.style.display = 'none'
                                  target.nextElementSibling?.classList.remove('hidden')
                                }}
                                onClick={(e) => {
                                  // Open image in new tab for larger view
                                  window.open(e.currentTarget.src, '_blank')
                                }}
                              />
                              <div className="hidden flex items-center justify-center h-32 text-gray-400">
                                <FileText className="h-8 w-8" />
                              </div>
                            </div>
                            
                            {/* Description */}
                            <div className="space-y-2">
                              <h4 className="text-sm font-medium">Description</h4>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {rfi.description}
                              </p>
                            </div>
                            
                            {/* Created Date */}
                            <div className="mt-3 pt-3 border-t">
                              <p className="text-xs text-muted-foreground">
                                Created: {new Date(rfi.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {["unmatched_column", "column_overlay", "unmatched_wall", "wall_overlay"].map((tabType) => {
                const displayName = {
                  "unmatched_column": "Column (Position)",
                  "column_overlay": "Column (Overlay)", 
                  "unmatched_wall": "Wall (Position)",
                  "wall_overlay": "Wall (Overlay)"
                }[tabType] || tabType;
                
                return (
                <TabsContent key={tabType} value={tabType} className="mt-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">
                      {displayName} RFIs ({filteredRfis.filter(rfi => rfi.type === tabType).length})
                    </h3>
                    <div className="space-y-6">
                      {filteredRfis.filter(rfi => rfi.type === tabType).map((rfi) => (
                        <Card key={rfi.id} className="overflow-hidden">
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <CardTitle className="text-sm font-medium">RFI #{rfi.id}</CardTitle>
                                <CardDescription className="text-xs mt-1">
                                  {new Date(rfi.createdAt).toLocaleDateString()}
                                </CardDescription>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <p className="text-sm text-gray-700 mb-4">{rfi.description}</p>
                            {rfi.checks.length > 0 && (
                              <CheckDisplay 
                                key={rfi.checks[0].id}
                                check={rfi.checks[0]} 
                                rfiId={rfi.id}
                                associatedChecks={rfi.checks}
                                showAssociatedChecks={true}
                              />
                            )}
                          </CardContent>
                        </Card>
                      ))}
                      {filteredRfis.filter(rfi => rfi.type === tabType).length === 0 && (
                        <div className="text-center py-8">
                          <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                          <p className="text-muted-foreground">No {displayName} RFIs found</p>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
                )
              })}
            </Tabs>
          )}
        </div>
      </div>
    </div>
  )
}