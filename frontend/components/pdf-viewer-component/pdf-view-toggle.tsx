'use client';

import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Pencil, Eye, MousePointer2 } from 'lucide-react';

export type ViewMode = 'edit' | 'patterns' | 'select';

interface PDFViewToggleProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export const PDFViewToggle: React.FC<PDFViewToggleProps> = ({
  currentView,
  onViewChange
}) => {
  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white rounded-lg shadow-lg border p-1">
      <ToggleGroup type="single" value={currentView} onValueChange={(value) => value && onViewChange(value as ViewMode)}>
        <ToggleGroupItem 
          value="edit" 
          aria-label="Edit Mode" 
          className="px-3 py-1.5 text-xs flex items-center gap-1 data-[state=on]:bg-blue-100 data-[state=on]:border-blue-300"
        >
          <Pencil className="w-3.5 h-3.5" />
          <span>Edit</span>
        </ToggleGroupItem>
        <ToggleGroupItem 
          value="patterns" 
          aria-label="Patterns Mode" 
          className="px-3 py-1.5 text-xs flex items-center gap-1 data-[state=on]:bg-green-100 data-[state=on]:border-green-300"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>View</span>
        </ToggleGroupItem>
        <ToggleGroupItem 
          value="select" 
          aria-label="Area Selection Mode" 
          className="px-3 py-1.5 text-xs flex items-center gap-1 data-[state=on]:bg-orange-100 data-[state=on]:border-orange-300"
        >
          <MousePointer2 className="w-3.5 h-3.5" />
          <span>Select</span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};
