"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, FileText, Clock, CheckCircle, PlayCircle, AlertCircle, Building, AlertTriangle, GitCompare, Bot, Calendar, BarChart3, Home, ChevronRight } from "lucide-react"
import Link from "next/link"
import RFIModal from "./components/RFIModal"

// Type definitions
interface Sheet {
  id: number;
  code: string;
  title: string;
  type: string;
  page: number;
  status: 'not started' | 'in progress' | 'completed';
  documentId: number;
}

interface Document {
  id: number;
  type?: string;
  path: string;
  title?: string;
  projectId: number;
  sheets?: Sheet[];
}

interface Project {
  id: number;
  name: string;
  date: string;
  documents?: Document[];
}

interface GroupedSheets {
  [key: string]: Sheet[];
}

export default function ProjectDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [filteredSheets, setFilteredSheets] = useState<Sheet[]>([])
  const [groupedSheets, setGroupedSheets] = useState<GroupedSheets>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRFIModal, setShowRFIModal] = useState(false)

  // Fetch project and documents data
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

        // Fetch documents for this project
        const documentsResponse = await fetch(`/api/documents?projectId=${projectId}`)
        if (!documentsResponse.ok) {
          throw new Error('Failed to fetch documents')
        }
        const documentsData = await documentsResponse.json()
        const fetchedDocuments = documentsData.documents || []
        setDocuments(fetchedDocuments)
        
        // Set the first document as selected by default if any exist
        if (fetchedDocuments.length > 0) {
          setSelectedDocumentId(fetchedDocuments[0].id)
        }

        // Fetch sheets for this project
        const sheetsResponse = await fetch(`/api/sheets?projectId=${projectId}`)
        if (!sheetsResponse.ok) {
          throw new Error('Failed to fetch sheets')
        }
        const sheetsData = await sheetsResponse.json()
        setSheets(sheetsData.sheets || [])

        setError(null)
      } catch (err) {
        console.error('Error fetching project data:', err)
        setError('Failed to load project data')
      } finally {
        setIsLoading(false)
      }
    }

    if (projectId) {
      fetchProjectData()
    }
  }, [projectId])

  // Filter and group sheets when selectedDocumentId or sheets change
  useEffect(() => {
    let filteredSheetsData: Sheet[] = []
    
    if (selectedDocumentId && sheets.length > 0) {
      filteredSheetsData = sheets.filter(sheet => sheet.documentId === selectedDocumentId)
    } else {
      filteredSheetsData = sheets
    }
    
    setFilteredSheets(filteredSheetsData)

    // Group filtered sheets by type based on sheet code prefix
    const grouped = filteredSheetsData.reduce((acc: GroupedSheets, sheet: Sheet) => {
      // Extract type from sheet code (e.g., "A2.31" -> "A" -> "Architectural")
      const typePrefix = sheet.code.charAt(0).toUpperCase()
      let type = 'Other'
      
      switch (typePrefix) {
        case 'A':
          type = 'Architectural'
          break
        case 'S':
          type = 'Structural'
          break
        case 'M':
          type = 'Mechanical'
          break
        case 'E':
          type = 'Electrical'
          break
        case 'P':
          type = 'Plumbing'
          break
        case 'C':
          type = 'Civil'
          break
        default:
          // Fallback to database type if available
          type = sheet.type || 'Other'
      }
      
      if (!acc[type]) {
        acc[type] = []
      }
      acc[type].push(sheet)
      return acc
    }, {})
    setGroupedSheets(grouped)
  }, [selectedDocumentId, sheets])

  // Get status color and icon
  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'completed':
        return { 
          color: 'text-emerald-700', 
          bgColor: 'bg-emerald-50 border-emerald-200', 
          textColor: 'text-emerald-700',
          dotColor: 'bg-emerald-500',
          icon: CheckCircle, 
          progress: 100 
        }
      case 'in progress':
        return { 
          color: 'text-blue-700', 
          bgColor: 'bg-blue-50 border-blue-200',
          textColor: 'text-blue-700',
          dotColor: 'bg-blue-500',
          icon: PlayCircle, 
          progress: 50 
        }
      default:
        return { 
          color: 'text-slate-600', 
          bgColor: 'bg-slate-50 border-slate-200',
          textColor: 'text-slate-600',
          dotColor: 'bg-slate-400',
          icon: Clock, 
          progress: 0 
        }
    }
  }

  // Get type color for grouping
  const getTypeColor = (type: string) => {
    const colors = {
      'Architectural': 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-indigo-100/50',
      'Structural': 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/50',
      'Mechanical': 'border-orange-200 bg-gradient-to-br from-orange-50 to-orange-100/50',
      'Electrical': 'border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100/50',
      'Plumbing': 'border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100/50',
      'Other': 'border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100/50'
    }
    return colors[type as keyof typeof colors] || colors['Other']
  }

  // Get type icon
  const getTypeIcon = (type: string) => {
    const icons = {
      'Architectural': Building,
      'Structural': Building,
      'Mechanical': AlertCircle,
      'Electrical': AlertTriangle,
      'Plumbing': AlertCircle,
      'Other': FileText
    }
    return icons[type as keyof typeof icons] || icons['Other']
  }

  if (isLoading) {
    return (
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div>
            <h1 className="font-semibold">Project Details</h1>
            <p className="text-sm text-muted-foreground">Loading project information...</p>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6">
          <div className="animate-pulse space-y-6">
            <div className="space-y-3">
              <div className="h-8 bg-gradient-to-r from-slate-200 to-slate-100 rounded-lg w-1/3"></div>
              <div className="h-4 bg-gradient-to-r from-slate-200 to-slate-100 rounded w-1/2"></div>
            </div>
            
            <div className="grid gap-4 md:grid-cols-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200">
                  <div className="space-y-3">
                    <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                    <div className="h-8 bg-slate-200 rounded w-1/3"></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="h-6 bg-gradient-to-r from-slate-200 to-slate-100 rounded w-1/4"></div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="p-4 bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200">
                    <div className="space-y-3">
                      <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                      <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                      <div className="h-2 bg-slate-200 rounded w-full"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    )
  }

  if (error || !project) {
    return (
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div>
            <h1 className="font-semibold">Project Details</h1>
            <p className="text-sm text-muted-foreground">Error loading project</p>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <h3 className="text-lg font-medium mb-2">Failed to load project</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => router.push('/projects')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Projects
            </Button>
          </div>
        </div>
      </SidebarInset>
    )
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
          
          <div className="flex items-center gap-2 text-gray-900">
            <div className="flex items-center justify-center w-8 h-8 bg-indigo-100 rounded-lg">
              <Building className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">{project.name}</h1>
              <p className="text-xs text-gray-500 flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Created {project.date}
                </span>
                <span className="flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" />
                  {filteredSheets.length} sheets {documents.length > 1 ? `(${sheets.length} total)` : ''}
                </span>
              </p>
            </div>
          </div>
        </nav>
        
        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button 
            onClick={() => router.push(`/projects/${projectId}/chatbot`)}
            variant="outline"
            size="sm"
            className="flex items-center gap-2 border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white transition-all"
          >
            <Bot className="h-4 w-4" />
            AI Assistant
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Document Tabs (only show if more than one document) */}
        {documents.length > 1 && (
          <Tabs value={selectedDocumentId?.toString()} onValueChange={(value) => setSelectedDocumentId(Number(value))}>
            <TabsList className={`grid w-full ${documents.length === 2 ? 'grid-cols-2' : documents.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
              {documents.map((document) => (
                <TabsTrigger key={document.id} value={document.id.toString()} className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4" />
                  <span className="truncate">{document.title || `Document ${document.id}`}</span>
                  <span className="text-xs bg-gray-200 px-2 py-1 rounded ml-auto">
                    {sheets.filter(s => s.documentId === document.id).length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}


        {/* Sheets by Type */}
        {Object.keys(groupedSheets).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl border-2 border-dashed border-slate-200">
            <div className="p-4 bg-white rounded-xl shadow-sm mb-4">
              <FileText className="h-12 w-12 text-slate-300" />
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">No sheets found</h3>
            <p className="text-slate-500 text-center max-w-md">
              This project doesn't have any construction drawing sheets yet. Sheets will appear here once they're uploaded to the project.
            </p>
          </div>
        ) : (
          Object.entries(groupedSheets).map(([type, typeSheets]) => {
            const TypeIcon = getTypeIcon(type)
            return (
              <div key={type} className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded-lg border shadow-sm">
                    <TypeIcon className="h-5 w-5 text-slate-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{type}</h2>
                    <p className="text-sm text-slate-500">{typeSheets.length} drawing sheets</p>
                  </div>
                </div>
                
                <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 p-6 rounded-xl border-2 ${getTypeColor(type)} shadow-sm`}>
                  {typeSheets.map((sheet) => {
                    const statusInfo = getStatusInfo(sheet.status)
                    const StatusIcon = statusInfo.icon
                    
                    return (
                      <Link href={`/projects/${projectId}/sheets/${sheet.id}`} key={sheet.id}>
                        <Card className="group hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer border-0 bg-white/90 backdrop-blur-sm hover:bg-white">
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base font-bold truncate text-slate-900 group-hover:text-indigo-600 transition-colors">
                                {sheet.code}
                              </CardTitle>
                              <div className={`px-2 py-1 rounded-full border ${statusInfo.bgColor} transition-all group-hover:scale-110`}>
                                <div className="flex items-center gap-1">
                                  <div className={`w-2 h-2 rounded-full ${statusInfo.dotColor}`}></div>
                                  <StatusIcon className={`h-3 w-3 ${statusInfo.color}`} />
                                </div>
                              </div>
                            </div>
                            <CardDescription className="text-sm text-slate-600 font-medium line-clamp-2">
                              {sheet.title || 'No title'}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-xs text-slate-500">
                                <span className="flex items-center gap-1">
                                  <FileText className="h-3 w-3" />
                                  Page {sheet.page}
                                </span>
                                <span className={`capitalize font-semibold px-2 py-1 rounded-md text-xs ${statusInfo.bgColor} ${statusInfo.textColor}`}>
                                  {sheet.status}
                                </span>
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs text-slate-400">
                                  <span>Progress</span>
                                  <span>{statusInfo.progress}%</span>
                                </div>
                                <Progress 
                                  value={statusInfo.progress} 
                                  className="h-2 bg-slate-100" 
                                />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>
      
      <RFIModal 
        isOpen={showRFIModal} 
        onClose={() => setShowRFIModal(false)} 
        projectId={projectId}
      />
    </SidebarInset>
  )
}