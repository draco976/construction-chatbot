"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Upload, FileText, Building, Clock, AlertTriangle, Trash2, CheckCircle, File, Home, BarChart3, Plus } from "lucide-react"
import Link from "next/link"

// Project data structure
interface Project {
  id: number;
  name: string;
  date: string;
  documents: number;
}

export default function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [projectToUpload, setProjectToUpload] = useState<Project | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true); 
  const [error, setError] = useState<string | null>(null);

  // Fetch projects from the API
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/projects');
        
        if (!response.ok) {
          throw new Error('Failed to fetch projects');
        }
        
        const data = await response.json();
        
        // Transform data to match our new structure
        const transformedData = data.map((project: any) => ({
          id: project.id,
          name: project.name,
          date: project.date,
          documents: project.documents || 0
        }));
        
        setProjects(transformedData);
        setError(null);
      } catch (err) {
        console.error('Error fetching projects:', err);
        setError('Failed to load projects. Please try again later.');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchProjects();
  }, []);

  const createNewProject = async () => {
    if (!newProjectName.trim()) return;
    
    try {
      // Create the project via API
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newProjectName }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to create project');
      }
      
      const newProject = await response.json();
      
      // Add the new project to the list with the expected format
      setProjects([...projects, {
        id: newProject.id,
        name: newProject.name,
        date: new Date(newProject.date).toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
        }),
        documents: 0
      }]);
      
      setNewProjectName("");
      setDialogOpen(false);
    } catch (err) {
      console.error('Error creating project:', err);
      // You could add error handling UI here
    }
  }

  const handleDeleteProject = (project: Project) => {
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  }

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;
    
    try {
      const response = await fetch(`/api/projects?id=${projectToDelete.id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete project');
      }
      
      // Remove the project from the list
      setProjects(projects.filter(p => p.id !== projectToDelete.id));
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (err) {
      console.error('Error deleting project:', err);
      // You could add error handling UI here
    }
  }

  const handleUploadDocument = (project: Project) => {
    setProjectToUpload(project);
    setUploadDialogOpen(true);
    setSelectedFile(null);
    setUploadSuccess(false);
    setUploadError(null);
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type === 'application/pdf') {
        setSelectedFile(file);
        setUploadSuccess(false);
        setUploadError(null);
      } else {
        setUploadError('Please select a PDF file only');
        setSelectedFile(null);
      }
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      if (file.type === 'application/pdf') {
        setSelectedFile(file);
        setUploadSuccess(false);
        setUploadError(null);
      } else {
        setUploadError('Please select a PDF file only');
        setSelectedFile(null);
      }
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }

  const uploadFile = async () => {
    if (!selectedFile || !projectToUpload) return;

    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('projectId', projectToUpload.id.toString());
      formData.append('type', 'document');

      const response = await fetch('/api/documents', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload file');
      }

      setUploadSuccess(true);
      setSelectedFile(null);
      
      // Update the project's document count
      setProjects(projects.map(p => 
        p.id === projectToUpload.id 
          ? { ...p, documents: p.documents + 1 }
          : p
      ));

      // Close dialog after a short delay
      setTimeout(() => {
        setUploadDialogOpen(false);
        setUploadSuccess(false);
      }, 2000);
    } catch (error) {
      console.error('Upload error:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <SidebarInset>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-white/95 backdrop-blur-sm px-6 shadow-sm">
        <SidebarTrigger className="-ml-1 hover:bg-gray-100 rounded-md transition-colors" />
        <Separator orientation="vertical" className="h-6 bg-gray-300" />
        
        {/* Dashboard Title Section */}
        <div className="flex items-center gap-2 flex-1">
          <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-lg">
            <Home className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Projects Dashboard</h1>
            <p className="text-xs text-gray-500">
              Manage all your construction projects
            </p>
          </div>
        </div>
        
        {/* Stats and Actions */}
        <div className="flex items-center gap-4">
          {/* Quick Stats */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
            <BarChart3 className="h-4 w-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">
              {projects.length} Projects
            </span>
          </div>
          
          {/* Create Project Button */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
              >
                <Plus className="h-4 w-4" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Project</DialogTitle>
                <DialogDescription>
                  Enter a name for your new construction project.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Input
                  placeholder="Project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createNewProject}>
                    Create Project
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Section Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Your Projects</h2>
        </div>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Project</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{projectToDelete?.name}"? This action cannot be undone and will permanently delete all associated documents and data.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={confirmDeleteProject}
                className="flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" />
                Delete Project
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Upload Document Dialog */}
        <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Upload Document</DialogTitle>
              <DialogDescription>
                Upload a document for "{projectToUpload?.name}"
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* File Upload Area */}
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors cursor-pointer"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => document.getElementById('upload-file-input')?.click()}
              >
                <input
                  id="upload-file-input"
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                  accept=".pdf,application/pdf"
                />
                
                {selectedFile ? (
                  <div className="space-y-2">
                    <FileText className="h-8 w-8 text-blue-500 mx-auto" />
                    <p className="font-medium text-sm">{selectedFile.name}</p>
                    <p className="text-xs text-gray-500">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 text-gray-400 mx-auto" />
                    <p className="font-medium">Choose a PDF file or drag it here</p>
                    <p className="text-xs text-gray-500">
                      Only PDF files are accepted
                    </p>
                  </div>
                )}
              </div>

              {/* Success Message */}
              {uploadSuccess && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">Document uploaded successfully!</span>
                </div>
              )}

              {/* Error Message */}
              {uploadError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800">
                  <p className="text-sm">Error: {uploadError}</p>
                </div>
              )}

              {/* Dialog Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <Button 
                  variant="outline" 
                  onClick={() => setUploadDialogOpen(false)}
                  disabled={uploading}
                >
                  Cancel
                </Button>
                <Button
                  onClick={uploadFile}
                  disabled={!selectedFile || uploading}
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-pulse flex flex-col items-center">
              <div className="h-12 w-12 rounded-full bg-gray-200 mb-4"></div>
              <div className="h-6 w-48 bg-gray-200 rounded mb-2"></div>
              <div className="h-4 w-36 bg-gray-200 rounded"></div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="text-center">
              <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Failed to load projects</h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => window.location.reload()}>
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="text-center">
              <FolderPlus className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No projects yet</h3>
              <p className="text-muted-foreground mb-4">Create your first project to get started</p>
              <Button onClick={() => setDialogOpen(true)}>
                Create New Project
              </Button>
            </div>
          </div>
        )}

        {/* Projects Grid */}
        {!isLoading && !error && projects.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
            <div key={project.id} className="relative">
              <Link href={`/projects/${project.id}`}>
                <Card className="overflow-hidden relative hover:shadow-lg transition-all duration-200 cursor-pointer hover:scale-[1.02]">
                  <CardHeader className="pb-2 pr-12">
                    <CardTitle className="flex items-center gap-2">
                      <Building className="h-5 w-5" />
                      {project.name}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {project.date}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <div className="flex items-center gap-1 text-sm">
                      <FileText className="h-4 w-4 text-blue-500" />
                      <span>{project.documents} Documents</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              
              {/* Small upload button in lower right corner */}
              <Button 
                size="sm" 
                className="absolute bottom-3 right-3 p-1 h-7 w-7 z-10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleUploadDocument(project);
                }}
                title="Upload Document"
              >
                <Upload className="h-3 w-3" />
              </Button>
              
              {/* Delete button */}
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDeleteProject(project);
                }}
                className="absolute top-3 right-3 p-1 h-auto w-auto text-gray-400 hover:text-red-600 hover:bg-red-50 z-20"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          </div>
        )}
      </div>
    </SidebarInset>
  )
}
