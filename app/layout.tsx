import type React from "react"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import "./globals.css"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <SidebarProvider>
          <AppSidebar />
          <main className="flex-1">{children}</main>
        </SidebarProvider>
      </body>
    </html>
  )
}

export const metadata = {
      generator: 'v0.dev'
    };
