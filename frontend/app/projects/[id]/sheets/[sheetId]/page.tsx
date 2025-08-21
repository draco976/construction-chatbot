"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, FileText, AlertCircle, Loader2 } from "lucide-react"
import Link from "next/link"
import { PDFSVGEditor } from "@/components/pdf-viewer-component/pdf-svg-editor"

// Type definitions
interface Sheet {
  id: number;
  code: string;
  title: string;
  type: string;
  page: number;
  status: 'not started' | 'in progress' | 'completed';
  svgPath: string | null;
  document: {
    id: number;
    path: string;
    project: {
      id: number;
      name: string;
    };
  };
}

export default function SheetDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  const sheetId = params.sheetId as string

  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch sheet data and SVG content
  useEffect(() => {
    const fetchSheetData = async () => {
      try {
        setIsLoading(true)
        
        // Fetch sheet details (now includes SVG content directly)
        const sheetResponse = await fetch(`http://localhost:8080/api/sheets/${sheetId}`)
        if (!sheetResponse.ok) {
          throw new Error('Failed to fetch sheet details')
        }
        const sheetData = await sheetResponse.json()
        setSheet(sheetData)
        
        console.log('Sheet data loaded:', sheetData)
        console.log('SVG content available:', !!sheetData.svgContent)

        // Set SVG content if it's included in the response
        if (sheetData.svgContent) {
          setSvgContent(sheetData.svgContent)
          console.log('SVG content set')
        } else {
          console.log('No SVG content in response')
        }

        setError(null)
      } catch (err) {
        console.error('Error fetching sheet data:', err)
        setError('Failed to load sheet data')
      } finally {
        setIsLoading(false)
      }
    }

    if (sheetId) {
      fetchSheetData()
    }
  }, [sheetId])

  if (isLoading) {
    return (
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div>
            <h1 className="font-semibold">Sheet Details</h1>
            <p className="text-sm text-muted-foreground">Loading sheet...</p>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading sheet details...</p>
            </div>
          </div>
        </div>
      </SidebarInset>
    )
  }

  if (error || !sheet) {
    return (
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div>
            <h1 className="font-semibold">Sheet Details</h1>
            <p className="text-sm text-muted-foreground">Error loading sheet</p>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <h3 className="text-lg font-medium mb-2">Failed to load sheet</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Link href={`/projects/${projectId}`}>
              <Button>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Project
              </Button>
            </Link>
          </div>
        </div>
      </SidebarInset>
    )
  }

  return (
    <SidebarInset className="h-screen">
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
              <FileText className="h-5 w-5" />
              {sheet.code}
            </h1>
            <p className="text-sm text-muted-foreground">
              {sheet.title || 'No title'} • Page {sheet.page} • {sheet.document.project.name}
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">
        {sheet.status === 'completed' && svgContent ? (
          // Open PDF viewer directly - no preview, render as full page component
          <PDFSVGEditor
            isOpen={true}
            onClose={() => window.history.back()}
            svgContent={svgContent}
            sheetData={{
              index: sheet.id,
              title: sheet.title || sheet.code
            }}
            navigationStack={[{ index: sheet.id, code: sheet.code }]}
          />
        ) : sheet.status === 'completed' && !svgContent ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">SVG Not Available</h3>
              <p className="text-muted-foreground mb-4">
                The sheet has been processed but the SVG file is not accessible.
              </p>
              <p className="text-sm text-gray-500">
                SVG Path: {sheet.svgPath || 'Not set'}
              </p>
              <div className="mt-4">
                <p className="text-xs text-gray-400">Debug: Sheet status = {sheet.status}, SVG content = {svgContent ? 'Available' : 'Not available'}</p>
              </div>
            </div>
          </div>
        ) : sheet.status === 'in progress' ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Processing Sheet</h3>
              <p className="text-muted-foreground">
                This sheet is currently being processed. Please check back in a few moments.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Sheet Not Processed</h3>
              <p className="text-muted-foreground">
                This sheet has not been processed yet. It will be processed automatically by the background worker.
              </p>
              <div className="mt-4">
                <p className="text-xs text-gray-400">Debug: Sheet status = {sheet.status}, SVG content = {svgContent ? 'Available' : 'Not available'}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </SidebarInset>
  )
}