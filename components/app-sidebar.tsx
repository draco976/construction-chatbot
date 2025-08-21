"use client"

import type * as React from "react"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import Link from "next/link"
import {
  Building2,
  FolderKanban,
  Building,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const navigation = [
  {
    title: "Projects",
    url: "/projects",
    icon: FolderKanban,
  }
]

interface Project {
  id: number;
  name: string;
  date: string;
  status: string;
  documents: number;
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await fetch('http://localhost:8080/api/projects')
        if (response.ok) {
          const projectsData = await response.json()
          setProjects(projectsData)
        }
      } catch (error) {
        console.error('Error fetching projects:', error)
      } finally {
        setIsLoadingProjects(false)
      }
    }

    fetchProjects()
  }, [])
  
  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-4 py-2">
          <Building2 className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="font-bold text-lg">Concrete Pro</h1>
            <p className="text-xs text-muted-foreground">Drawing Analysis</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname === item.url}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoadingProjects ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <div className="animate-pulse flex items-center">
                      <div className="h-4 w-4 bg-gray-300 rounded mr-2"></div>
                      <div className="h-4 bg-gray-300 rounded flex-1"></div>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : projects.length > 0 ? (
                projects.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton asChild isActive={pathname.includes(`/projects/${project.id}`)}>
                      <Link href={`/projects/${project.id}`}>
                        <Building className="h-4 w-4" />
                        <span className="truncate">{project.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <Building className="h-4 w-4 opacity-50" />
                    <span className="text-muted-foreground">No projects</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
