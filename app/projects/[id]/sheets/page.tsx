"use client"

import { ArrowLeft, FileText, Download, Eye } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { useRouter, useParams } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"

interface Sheet {
  id: number
  code: string
  title?: string
  type?: string
  page?: number
  status: string
  svgPath?: string
}

interface PDFDetection {
  filename: string
  page: number
  pdfPath: string
  sheet?: Sheet
}

export default function DetectionsPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string
  
  const [pdfDetections, setPdfDetections] = useState<PDFDetection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (projectId) {
      loadPDFDetections()
    }
  }, [projectId])

  const loadPDFDetections = async () => {
    try {
      setLoading(true)
      setError(null)
      
      // Get list of PDF files in public/columns-walls
      const pdfFiles = [
        'columns_walls_overlay_page_135.pdf',
        'columns_walls_overlay_page_136.pdf', 
        'columns_walls_overlay_page_137.pdf',
        'columns_walls_overlay_page_138.pdf',
        'columns_walls_overlay_page_139.pdf',
        'columns_walls_overlay_page_140.pdf',
        'columns_walls_overlay_page_141.pdf',
        'columns_walls_overlay_page_142.pdf',
        'columns_walls_overlay_page_143.pdf',
        'columns_walls_overlay_page_144.pdf',
        'columns_walls_overlay_page_145.pdf',
        'columns_walls_overlay_page_146.pdf',
        'columns_walls_overlay_page_147.pdf',
        'columns_walls_overlay_page_148.pdf',
        'columns_walls_overlay_page_149.pdf'
      ]
      
      // Extract page numbers and create PDF detection objects
      const detections: PDFDetection[] = []
      
      for (const filename of pdfFiles) {
        const pageMatch = filename.match(/page_(\d+)\.pdf$/)
        if (pageMatch) {
          const pageNumber = parseInt(pageMatch[1])
          detections.push({
            filename,
            page: pageNumber,
            pdfPath: `/columns-walls/${filename}`
          })
        }
      }
      
      // Sort by page number
      detections.sort((a, b) => a.page - b.page)
      
      // Fetch sheet information from database for each page
      const detectionsWithData = await Promise.all(
        detections.map(async (pdfDetection) => {
          try {
            const response = await fetch(`/api/page?page=${pdfDetection.page}`)
            if (response.ok) {
              const data = await response.json()
              return {
                ...pdfDetection,
                sheet: data.sheet
              }
            }
          } catch (error) {
            console.error(`Error fetching sheet data for page ${pdfDetection.page}:`, error)
          }
          return pdfDetection
        })
      )
      
      setPdfDetections(detectionsWithData)
    } catch (err) {
      console.error('Error loading PDF detections:', err)
      setError('Failed to load PDF detections')
    } finally {
      setLoading(false)
    }
  }

  const handleViewPDF = (pdfPath: string) => {
    window.open(pdfPath, '_blank')
  }

  const handleDownloadPDF = (pdfPath: string, filename: string) => {
    const link = document.createElement('a')
    link.href = pdfPath
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <SidebarInset>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <div className="flex items-center gap-4 flex-1">
          <Link href={`/projects/${projectId}/rfis`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to RFIs
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Column and Wall Detections
            </h1>
            <p className="text-base text-gray-600 mt-1">Detection overlay results for columns and walls</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-8 p-8 bg-gradient-to-br from-blue-50/30 via-purple-50/20 to-pink-50/30 min-h-screen">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-red-500 mb-4" />
            <h3 className="text-lg font-medium mb-2">Error Loading Detections</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={loadPDFDetections} variant="outline">
              Try Again
            </Button>
          </div>
        ) : pdfDetections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium mb-2">No Detections Found</h3>
            <p className="text-muted-foreground">
              No detection results found in the columns-walls directory.
            </p>
          </div>
        ) : (
          <div className="space-y-6">   
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {pdfDetections.map((pdfDetection) => (
                <Card key={pdfDetection.filename} className="w-full overflow-hidden hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg font-semibold">
                          Page {pdfDetection.page}
                        </CardTitle>
                        <CardDescription className="text-sm mt-1">
                          {pdfDetection.sheet?.code || 'Unknown Sheet'}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="space-y-4">
                    {/* Sheet Information */}
                    {pdfDetection.sheet && (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Code:</span>
                          <span className="text-gray-900 font-medium">{pdfDetection.sheet.code}</span>
                        </div>
                        {pdfDetection.sheet.title && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Title:</span>
                            <span className="text-gray-900 text-right text-xs max-w-32 truncate" title={pdfDetection.sheet.title}>
                              {pdfDetection.sheet.title}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="w-full"
                        onClick={() => handleViewPDF(pdfDetection.pdfPath)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </SidebarInset>
  )
}