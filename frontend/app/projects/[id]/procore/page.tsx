"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, FileText, Building, ExternalLink, BookOpen, RefreshCw, Eye, Download } from "lucide-react"
import Link from "next/link"

// Type definitions
interface ProcoreProject {
  id: string;
  name: string;
  project_number?: string;
  description?: string;
  stage?: string;
  procore_url?: string;
}

interface ProcoreDocument {
  file_id: string;
  name: string;
  size?: number;
  updated_at?: string;
  download_url?: string;
}

interface ProcoreDocumentsResponse {
  folder_name: string;
  path: string;
  count: number;
  files: ProcoreDocument[];
}

export default function ProcoreProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  // State management (no project info needed)
  const [procoreDocuments, setProcoreDocuments] = useState<ProcoreDocument[]>([])
  const [procoreSpecifications, setProcoreSpecifications] = useState<ProcoreDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [specificationsLoading, setSpecificationsLoading] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Check Procore authentication status by trying to fetch documents (like reference implementation)
  const checkAuthentication = async () => {
    try {
      const response = await fetch('http://localhost:8080/procore/documents', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      })
      setIsAuthenticated(response.ok)
      return response.ok
    } catch (error) {
      console.error('Error checking authentication:', error)
      setIsAuthenticated(false)
      return false
    }
  }

  // Start Procore OAuth login
  const startProcoreLogin = async () => {
    try {
      console.log('🔐 Starting Procore login...')
      const response = await fetch('http://localhost:8080/procore/auth/login', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      })
      
      console.log('📡 Response status:', response.status)
      console.log('📡 Response ok:', response.ok)
      
      if (response.ok) {
        const data = await response.json()
        console.log('📄 Response data:', data)
        console.log('🌐 Redirecting to:', data.redirect_url)
        
        // OAuth URL received successfully, proceeding with redirect
        
        // Try multiple redirect methods in case of popup blockers
        try {
          window.location.href = data.redirect_url
        } catch (redirectError) {
          console.error('❌ Direct redirect failed:', redirectError)
          // Fallback: open in new tab
          window.open(data.redirect_url, '_blank')
        }
      } else {
        const errorText = await response.text()
        console.error('❌ Login failed:', response.status, errorText)
        alert(`Failed to start Procore authentication: ${response.status} ${errorText}`)
      }
    } catch (error) {
      console.error('❌ Error starting Procore login:', error)
      alert(`Failed to start Procore authentication: ${error.message}`)
    }
  }

  // No project info needed - reference implementation doesn't have this

  // Fetch Procore documents (PDF drawings)
  const fetchProcoreDocuments = async () => {
    try {
      setDocumentsLoading(true)
      const response = await fetch('http://localhost:8080/procore/documents', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      })
      
      if (response.ok) {
        const data: ProcoreDocumentsResponse = await response.json()
        setProcoreDocuments(data.files || [])
      } else if (response.status === 401) {
        setIsAuthenticated(false)
        setProcoreDocuments([])
      } else {
        console.error('Failed to fetch Procore documents')
        setProcoreDocuments([])
      }
    } catch (error) {
      console.error('Error fetching Procore documents:', error)
      setProcoreDocuments([])
    } finally {
      setDocumentsLoading(false)
    }
  }

  // Fetch Procore specifications
  const fetchProcoreSpecifications = async () => {
    try {
      setSpecificationsLoading(true)
      const response = await fetch('http://localhost:8080/procore/specifications', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      })
      
      if (response.ok) {
        const data: ProcoreDocumentsResponse = await response.json()
        setProcoreSpecifications(data.files || [])
      } else if (response.status === 401) {
        setIsAuthenticated(false)
        setProcoreSpecifications([])
      } else {
        console.error('Failed to fetch Procore specifications')
        setProcoreSpecifications([])
      }
    } catch (error) {
      console.error('Error fetching Procore specifications:', error)
      setProcoreSpecifications([])
    } finally {
      setSpecificationsLoading(false)
    }
  }

  // Format file size for display
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown size'
    return `${Math.round(bytes / 1024 / 1024)}MB`
  }

  // Format date for display
  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'Unknown date'
    return new Date(dateString).toLocaleDateString()
  }

  // Open the existing sheets page (current behavior when clicking project card)
  const openSheetsPage = () => {
    router.push(`/projects/11`)
  }

  // Load data on component mount
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true)
      const authenticated = await checkAuthentication()
      
      if (authenticated) {
        await fetchProcoreDocuments()
        await fetchProcoreSpecifications()
      }
      
      setIsLoading(false)
    }

    loadData()
  }, [])

  if (isLoading) {
    return (
      <SidebarInset>
        <div className="flex h-full items-center justify-center">
          <div className="text-center space-y-2">
            <div className="animate-pulse text-lg font-medium">Loading Procore project...</div>
            <p className="text-sm text-muted-foreground">
              Checking authentication and fetching project details
            </p>
          </div>
        </div>
      </SidebarInset>
    )
  }

  if (!isAuthenticated) {
    return (
      <SidebarInset>
        <div className="flex h-full flex-col">
          {/* Header */}
          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            
            <div className="flex items-center gap-2">
              <Link href="/projects">
                <Button variant="ghost" size="sm" className="gap-1">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Projects
                </Button>
              </Link>
              
              <Separator orientation="vertical" className="h-4" />
              <div className="flex items-center gap-2">
                <Building className="h-4 w-4" />
                <span className="font-medium">Procore Integration</span>
              </div>
            </div>
          </header>

          {/* Authentication required content */}
          <div className="flex flex-1 items-center justify-center p-6">
            <Card className="max-w-md">
              <CardHeader className="text-center">
                <Building className="h-12 w-12 mx-auto mb-4 text-blue-600" />
                <CardTitle>Procore Authentication Required</CardTitle>
                <CardDescription>
                  Connect to Procore to view project documents, specifications, and drawings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button 
                  onClick={startProcoreLogin}
                  className="w-full"
                  size="lg"
                >
                  <Building className="h-4 w-4 mr-2" />
                  Connect to Procore
                </Button>
                
                <div className="text-center">
                  <Button 
                    variant="ghost" 
                    onClick={openSheetsPage}
                    className="text-sm"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    View Local Sheets Instead
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    )
  }

  return (
    <SidebarInset>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          
          <div className="flex items-center gap-2">
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="gap-1">
                <ArrowLeft className="h-4 w-4" />
                Back to Projects
              </Button>
            </Link>
            
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4" />
              <span className="font-medium">Procore Integration</span>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 flex-col gap-6 p-6">
          {/* Simple header with View Sheets button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building className="h-5 w-5" />
              <h1 className="text-xl font-semibold">Procore Documents</h1>
            </div>
            <Button 
              onClick={openSheetsPage}
              variant="default"
              size="sm"
              className="flex items-center gap-1"
            >
              <Eye className="h-3 w-3" />
              View Sheets
            </Button>
          </div>

          {/* Documents and Specifications Grid */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* PDF Drawings */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        PDF Drawings ({procoreDocuments.length})
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={fetchProcoreDocuments}
                        disabled={documentsLoading}
                      >
                        <RefreshCw className={`h-3 w-3 ${documentsLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {documentsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-pulse text-sm text-muted-foreground">
                          Loading drawings...
                        </div>
                      </div>
                    ) : procoreDocuments.length > 0 ? (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {procoreDocuments.map((doc, index) => (
                          <div key={index} className="flex items-center justify-between p-3 rounded border bg-gray-50 hover:bg-gray-100">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{doc.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatFileSize(doc.size)} • {formatDate(doc.updated_at)}
                                </p>
                              </div>
                            </div>
                            {doc.download_url && (
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => window.open(doc.download_url, '_blank')}
                                className="flex-shrink-0"
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        No PDF drawings found
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Specifications */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        Specifications ({procoreSpecifications.length})
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={fetchProcoreSpecifications}
                        disabled={specificationsLoading}
                      >
                        <RefreshCw className={`h-3 w-3 ${specificationsLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {specificationsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-pulse text-sm text-muted-foreground">
                          Loading specifications...
                        </div>
                      </div>
                    ) : procoreSpecifications.length > 0 ? (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {procoreSpecifications.map((spec, index) => (
                          <div key={index} className="flex items-center justify-between p-3 rounded border bg-gray-50 hover:bg-gray-100">
                            <div className="flex items-center gap-2">
                              <BookOpen className="h-4 w-4 text-green-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{spec.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatFileSize(spec.size)} • {formatDate(spec.updated_at)}
                                </p>
                              </div>
                            </div>
                            {spec.download_url && (
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => window.open(spec.download_url, '_blank')}
                                className="flex-shrink-0"
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        No specifications found
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
        </div>

        {/* Footer */}
        <div className="mt-auto border-t bg-muted/10 px-6 py-4">
          <div className="text-center text-sm text-muted-foreground space-y-2">
            <p>Connected to Procore project management system.</p>
            <div className="flex items-center justify-center gap-2">
              <span>© ContextFort INCORPORATED</span>
              <button className="underline hover:no-underline">
                Terms & Privacy
              </button>
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  )
}