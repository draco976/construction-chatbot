"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, GitCompare, FileText, AlertCircle, Download, Eye } from "lucide-react"
import Link from "next/link"

// Type definitions
interface Sheet {
  id: number;
  code: string;
  title: string;
  type: string;
  page: number;
  status: 'not started' | 'in progress' | 'completed';
  documentId: number;
  svgPath?: string;
}

interface Document {
  id: number;
  type?: string;
  path: string;
  title?: string;
  projectId: number;
}

interface Project {
  id: number;
  name: string;
  date: string;
}

interface SheetComparison {
  sheetCode: string;
  documents: {
    documentId: number;
    documentTitle: string;
    sheet: Sheet;
  }[];
}

interface DiffResult {
  sheetCode: string;
  document1: { id: number; title: string; };
  document2: { id: number; title: string; };
  adds: number;
  deletes: number;
  moves: number;
  diffImagePath?: string;
  processed: boolean;
}

export default function VersionControlPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetComparisons, setSheetComparisons] = useState<SheetComparison[]>([])
  const [diffResults, setDiffResults] = useState<DiffResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processingDiffs, setProcessingDiffs] = useState(false)

  // Fetch project, documents, and sheets data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true)
        
        // Fetch project details
        const projectResponse = await fetch(`/api/projects/${projectId}`)
        if (!projectResponse.ok) {
          throw new Error('Failed to fetch project')
        }
        const projectData = await projectResponse.json()
        setProject(projectData)

        // Fetch documents
        const documentsResponse = await fetch(`/api/documents?projectId=${projectId}`)
        if (!documentsResponse.ok) {
          throw new Error('Failed to fetch documents')
        }
        const documentsData = await documentsResponse.json()
        const fetchedDocuments = documentsData.documents || []
        setDocuments(fetchedDocuments)

        // Fetch sheets
        const sheetsResponse = await fetch(`/api/sheets?projectId=${projectId}`)
        if (!sheetsResponse.ok) {
          throw new Error('Failed to fetch sheets')
        }
        const sheetsData = await sheetsResponse.json()
        const fetchedSheets = sheetsData.sheets || []
        setSheets(fetchedSheets)

        // Analyze sheets for comparisons
        analyzeSheetComparisons(fetchedSheets, fetchedDocuments)

        setError(null)
      } catch (err) {
        console.error('Error fetching data:', err)
        setError('Failed to load version control data')
      } finally {
        setIsLoading(false)
      }
    }

    if (projectId) {
      fetchData()
    }
  }, [projectId])

  const analyzeSheetComparisons = (allSheets: Sheet[], allDocuments: Document[]) => {
    // Group sheets by sheet code
    const sheetsByCode: { [code: string]: Sheet[] } = {}
    
    allSheets.forEach(sheet => {
      if (!sheetsByCode[sheet.code]) {
        sheetsByCode[sheet.code] = []
      }
      sheetsByCode[sheet.code].push(sheet)
    })

    // Find sheet codes that appear in multiple documents
    const comparisons: SheetComparison[] = []
    
    Object.entries(sheetsByCode).forEach(([sheetCode, sheets]) => {
      if (sheets.length > 1) {
        // Check if sheets are from different documents
        const uniqueDocuments = [...new Set(sheets.map(s => s.documentId))]
        
        if (uniqueDocuments.length > 1) {
          const comparison: SheetComparison = {
            sheetCode,
            documents: uniqueDocuments.map(docId => {
              const sheet = sheets.find(s => s.documentId === docId)!
              const document = allDocuments.find(d => d.id === docId)!
              return {
                documentId: docId,
                documentTitle: document?.title || `Document ${docId}`,
                sheet
              }
            })
          }
          comparisons.push(comparison)
        }
      }
    })

    setSheetComparisons(comparisons)
  }

  const processDifferences = async () => {
    if (sheetComparisons.length === 0) return

    setProcessingDiffs(true)
    const results: DiffResult[] = []

    try {
      for (const comparison of sheetComparisons) {
        // For each comparison, process all possible pairs
        for (let i = 0; i < comparison.documents.length; i++) {
          for (let j = i + 1; j < comparison.documents.length; j++) {
            const doc1 = comparison.documents[i]
            const doc2 = comparison.documents[j]

            // Call the backend API to process diff
            const diffResponse = await fetch('/api/sheet-diff', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                projectId,
                sheetCode: comparison.sheetCode,
                sheet1Id: doc1.sheet.id,
                sheet2Id: doc2.sheet.id,
                document1Id: doc1.documentId,
                document2Id: doc2.documentId
              })
            })

            if (diffResponse.ok) {
              const diffData = await diffResponse.json()
              results.push({
                sheetCode: comparison.sheetCode,
                document1: { id: doc1.documentId, title: doc1.documentTitle },
                document2: { id: doc2.documentId, title: doc2.documentTitle },
                adds: diffData.adds || 0,
                deletes: diffData.deletes || 0,
                moves: diffData.moves || 0,
                diffImagePath: diffData.diffImagePath,
                processed: true
              })
            } else {
              results.push({
                sheetCode: comparison.sheetCode,
                document1: { id: doc1.documentId, title: doc1.documentTitle },
                document2: { id: doc2.documentId, title: doc2.documentTitle },
                adds: 0,
                deletes: 0,
                moves: 0,
                processed: false
              })
            }
          }
        }
      }

      setDiffResults(results)
    } catch (error) {
      console.error('Error processing differences:', error)
      setError('Failed to process sheet differences')
    } finally {
      setProcessingDiffs(false)
    }
  }

  if (isLoading) {
    return (
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div>
            <h1 className="font-semibold">Version Control</h1>
            <p className="text-sm text-muted-foreground">Loading version comparison data...</p>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="grid gap-4 md:grid-cols-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-32 bg-gray-200 rounded"></div>
              ))}
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
            <h1 className="font-semibold">Version Control</h1>
            <p className="text-sm text-muted-foreground">Error loading data</p>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <h3 className="text-lg font-medium mb-2">Failed to load version control</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => router.push(`/projects/${projectId}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Project
            </Button>
          </div>
        </div>
      </SidebarInset>
    )
  }

  return (
    <SidebarInset>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <div className="flex items-center gap-4 flex-1">
          <Link href={`/projects/${projectId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="font-semibold flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              Version Control
            </h1>
            <p className="text-sm text-muted-foreground">
              Compare sheets across different document versions
            </p>
          </div>
        </div>
        {sheetComparisons.length > 0 && (
          <Button 
            onClick={processDifferences}
            disabled={processingDiffs}
            className="flex items-center gap-2"
          >
            <GitCompare className="h-4 w-4" />
            {processingDiffs ? 'Processing...' : 'Analyze Differences'}
          </Button>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{documents.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Sheets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{sheets.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Comparable Sheets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{sheetComparisons.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* No Comparisons Available */}
        {sheetComparisons.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <GitCompare className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium mb-2">No Version Comparisons Available</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Version comparison requires sheets with the same code across different documents. 
              Upload multiple document versions to see comparisons here.
            </p>
          </div>
        ) : (
          <>
            {/* Sheet Comparisons */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Sheet Comparisons</h2>
                <p className="text-sm text-gray-600">
                  {sheetComparisons.length} sheet{sheetComparisons.length !== 1 ? 's' : ''} available for comparison
                </p>
              </div>

              <div className="grid gap-4">
                {sheetComparisons.map((comparison) => (
                  <Card key={comparison.sheetCode}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <FileText className="h-5 w-5" />
                          Sheet: {comparison.sheetCode}
                        </CardTitle>
                        <Badge variant="outline">
                          {comparison.documents.length} versions
                        </Badge>
                      </div>
                      <CardDescription>
                        Available in {comparison.documents.length} different documents
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3">
                        <div className="flex flex-wrap gap-2">
                          {comparison.documents.map((doc) => (
                            <Badge key={doc.documentId} variant="secondary" className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {doc.documentTitle}
                              <span className="text-xs">({doc.sheet.type})</span>
                            </Badge>
                          ))}
                        </div>
                        
                        {/* Show diff results if available */}
                        {diffResults.filter(result => result.sheetCode === comparison.sheetCode).map((result, idx) => (
                          <div key={idx} className="border rounded-lg p-4 bg-gray-50 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium">
                                {result.document1.title} ↔ {result.document2.title}
                              </div>
                              {result.processed && result.diffImagePath && (
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline" onClick={() => window.open(`http://localhost:8080${result.diffImagePath}`, '_blank')}>
                                    <Eye className="h-3 w-3 mr-1" />
                                    View Diff
                                  </Button>
                                  <Button size="sm" variant="outline" asChild>
                                    <a href={`http://localhost:8080${result.diffImagePath}`} download={`${result.sheetCode}_diff.svg`}>
                                      <Download className="h-3 w-3 mr-1" />
                                      Download
                                    </a>
                                  </Button>
                                </div>
                              )}
                            </div>
                            
                            {result.processed ? (
                              <>
                                <div className="flex gap-4 text-sm">
                                  <span className="text-green-600 font-medium">+{result.adds} additions</span>
                                  <span className="text-red-600 font-medium">-{result.deletes} deletions</span>
                                  <span className="text-blue-600 font-medium">{result.moves} moves</span>
                                </div>
                                
                                {/* Visual diff preview */}
                                {result.diffImagePath && (
                                  <div className="mt-3">
                                    <div className="text-xs text-gray-600 mb-2">Visual Diff Preview:</div>
                                    <div 
                                      className="border rounded-lg overflow-hidden bg-white cursor-pointer hover:shadow-md transition-shadow"
                                      onClick={() => window.open(`http://localhost:8080${result.diffImagePath}`, '_blank')}
                                    >
                                      <div className="aspect-[3/2] max-h-40 bg-gray-100 flex items-center justify-center relative">
                                        <iframe
                                          src={`http://localhost:8080${result.diffImagePath}`}
                                          className="w-full h-full border-none"
                                          style={{ transform: 'scale(0.3)', transformOrigin: 'top left', width: '333%', height: '333%' }}
                                        />
                                        <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-5 transition-colors flex items-center justify-center">
                                          <div className="bg-white bg-opacity-90 px-2 py-1 rounded text-xs font-medium opacity-0 hover:opacity-100 transition-opacity">
                                            Click to view full size
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                
                                {/* Legend */}
                                <div className="text-xs text-gray-500 bg-white p-2 rounded border">
                                  <strong>Legend:</strong> 
                                  <span className="text-green-600 ml-2">🟢 Green = Added elements</span>
                                  <span className="text-red-600 ml-2">🔴 Red = Deleted elements</span>
                                  <span className="text-blue-600 ml-2">🔵 Blue = Moved elements</span>
                                </div>
                              </>
                            ) : (
                              <div className="text-sm text-gray-500">
                                Failed to process comparison
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </SidebarInset>
  )
}