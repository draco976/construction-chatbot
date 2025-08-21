'use client';

import React from 'react';
import { Move, X } from 'lucide-react';
import { ZoomWindow, BoundingBox, searchIntegerPatternAcrossSheets, IntegerPatternSearchResult } from '@/lib/bounding-box';
import { IntegerPatternZoomWindow } from './integer-pattern-zoom-window';
import { GenericPatternZoomWindow } from './generic-pattern-zoom-window';

interface ZoomWindowComponentProps {
  window: ZoomWindow;
  svgContent: string | null;
  svgDimensions: { width: number; height: number };
  handleZoomWindowDrag: (id: string, newPosition: { x: number; y: number }) => void;
  removeZoomWindow: (id: string) => void;
  // Pattern-related props
  sfPatterns?: any[];
  cwPatterns?: any[];
  integerPatterns?: any[]; // Added integerPatterns to props
  transformPatternCoordinates?: (coords: any, svgDimensions?: { width: number; height: number }) => any;
  isPatternWithinBoundingBox?: (patternCoords: any, boundingBox: BoundingBox, transformFn: any) => boolean;
  onPatternClick?: (pattern: any, type: string) => void;
  onNestedPatternClick?: (pattern: any, type: string, parentWindowId: string) => void; // New prop for nested clicks
  // Main PDF viewer zoom state props
  mainViewerZoomScale?: number;
  mainViewerZoomEnabled?: boolean;
}

export const ZoomWindowComponent = ({
  window,
  svgContent,
  svgDimensions,
  handleZoomWindowDrag,
  removeZoomWindow,
  sfPatterns = [],
  cwPatterns = [],
  integerPatterns = [], // Using the default value
  transformPatternCoordinates,
  isPatternWithinBoundingBox,
  onPatternClick,
  onNestedPatternClick,
  mainViewerZoomScale = 1,
  mainViewerZoomEnabled = true
}: ZoomWindowComponentProps) => {
  // Extract pattern information from sourcePattern if available
  const patternCode = React.useMemo(() => {
    if (!window.sourcePattern) return undefined;
    
    // Try to get the pattern code from various sources
    if (window.sourcePattern.extractedSheetCode) {
      return window.sourcePattern.extractedSheetCode;
    }
    if (window.sourcePattern.text) {
      return window.sourcePattern.text;
    }
    if (window.sourcePattern.code) {
      return window.sourcePattern.code;
    }
    
    return undefined;
  }, [window.sourcePattern]);

  const patternType = React.useMemo(() => {
    if (!window.sourcePattern) return undefined;
    
    // Check if the pattern has a pattern_type field (from analysis data)
    if (window.sourcePattern.pattern_type === 'sf_patterns') {
      return 'sf' as const;
    }
    if (window.sourcePattern.pattern_type === 'cw_patterns') {
      return 'cw' as const;
    }
    if (window.sourcePattern.pattern_type === 'sheet_codes') {
      return 'sheet' as const;
    }
    
    // Check the legacy type field
    if (window.sourcePattern.type === 'sf' || window.sourcePattern.patternType === 'sf') {
      return 'sf' as const;
    }
    if (window.sourcePattern.type === 'cw' || window.sourcePattern.patternType === 'cw') {
      return 'cw' as const;
    }
    if (window.sourcePattern.type === 'sheet' || window.sourcePattern.patternType === 'sheet') {
      return 'sheet' as const;
    }
    
    // Try to infer from the pattern text
    if (window.sourcePattern.text) {
      const text = window.sourcePattern.text.toUpperCase();
      if (text.match(/^SF\d+[A-Z]?$/)) {
        return 'sf' as const;
      }
      if (text.match(/^CW\d+[A-Z]?$/)) {
        return 'cw' as const;
      }
      if (text.match(/^[A-Z]-\d+\.\d+[A-Z]?$/)) {
        return 'sheet' as const;
      }
    }
    
    // Check for sheet codes - these could be in various places
    if (window.sourcePattern.extractedSheetCode || (window.sourcePattern.text && /[A-Z]-\d+/.test(window.sourcePattern.text))) {
      return 'sheet' as const;
    }
    
    return undefined;
  }, [window.sourcePattern]);

  // State for integer pattern search results
  const [patternSearchResults, setPatternSearchResults] = React.useState<IntegerPatternSearchResult[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);

  // Create a safe version of SVG content with image tag fallback
  const processedSvgContent = React.useMemo(() => {
    if (!svgContent) return null;
    
    // We'll just use the entire SVG content directly
    return svgContent;
  }, [svgContent]);

  // Search for integer pattern occurrences across all sheets
  const searchIntegerPatterns = React.useCallback(async () => {
    // Determine the pattern type based on source pattern only
    const isIntegerPattern = window.sourcePattern?.patternType === 'integer';
    
    // Only search if the window shows an integer pattern
    const patternToSearch = window.sourcePattern?.patternType === 'integer' 
      ? window.sourcePattern.text
      : null;
    
    if (!patternToSearch) return;
    
    setIsSearching(true);
    try {
      const results = await searchIntegerPatternAcrossSheets(patternToSearch);
      setPatternSearchResults(results);
    } catch (error) {
      console.error('Error searching for integer patterns:', error);
    } finally {
      setIsSearching(false);
    }
  }, [window.sourcePattern, integerPatterns]);

  // Trigger the search when the window is created with an integer pattern
  React.useEffect(() => {
    if (window.sourcePattern?.patternType === 'integer') {
      searchIntegerPatterns();
    }
  }, [window.sourcePattern, searchIntegerPatterns]);

  // Handler for nested pattern clicks
  const handleNestedPatternClick = React.useCallback((pattern: any, type: string) => {
    if (onNestedPatternClick) {
      onNestedPatternClick(pattern, type, window.id);
    }
  }, [onNestedPatternClick, window.id]);

  // Calculate dynamic size based on main viewer zoom
  const calculateWindowSize = React.useMemo(() => {
    if (!mainViewerZoomEnabled) {
      return { width: 1050, height: 1050 }; // Default size
    }

    // Base size for the zoom window
    const baseSize = 450;
    
    // Calculate zoom-responsive size
    // When main viewer is zoomed in (scale > 1), make zoom window BIGGER
    // When main viewer is zoomed out (scale < 1), make zoom window smaller
    const responsiveScale = Math.max(0.3, Math.min(3, mainViewerZoomScale || 1));
    
    // Apply responsive scaling with limits
    const finalSize = Math.max(300, Math.min(1200, baseSize * responsiveScale));
    
    // Ensure window doesn't exceed 80% of viewport when zoomed in
    const viewportWidth = typeof globalThis.window !== 'undefined' ? globalThis.window.innerWidth : 1920;
    const viewportHeight = typeof globalThis.window !== 'undefined' ? globalThis.window.innerHeight : 1080;
    const maxSize = Math.min(viewportWidth * 0.8, viewportHeight * 0.8);
    
    const constrainedSize = Math.min(finalSize, maxSize);
    
    return { width: constrainedSize, height: constrainedSize };
  }, [mainViewerZoomScale, mainViewerZoomEnabled]);

  // Create a resizable zoom window state
  const [windowSize, setWindowSize] = React.useState(calculateWindowSize);

  // Update window size when main viewer zoom changes
  React.useEffect(() => {
    setWindowSize(calculateWindowSize);
  }, [calculateWindowSize]);

  // Adjust window position to avoid going off-screen when resizing
  const adjustedPosition = React.useMemo(() => {
    const { x, y } = window.position;
    const viewportWidth = typeof globalThis.window !== 'undefined' ? globalThis.window.innerWidth : 1920;
    const viewportHeight = typeof globalThis.window !== 'undefined' ? globalThis.window.innerHeight : 1080;
    
    // Calculate adjusted position to keep window within viewport
    const maxX = viewportWidth - windowSize.width - 20; // 20px margin
    const maxY = viewportHeight - windowSize.height - 20; // 20px margin
    
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY)
    };
  }, [window.position, windowSize]);

  // Create zoom indicator text
  const zoomIndicatorText = React.useMemo(() => {
    if (!mainViewerZoomEnabled) return '';
    
    const zoomPercentage = Math.round((mainViewerZoomScale || 1) * 100);
    const windowSizePercentage = Math.round((windowSize.width / 450) * 100);
    
    return `Main: ${zoomPercentage}% | Window: ${windowSizePercentage}%`;
  }, [mainViewerZoomScale, mainViewerZoomEnabled, windowSize.width]);

  // Determine which type of zoom window to show based on pattern type
  const renderZoomWindow = () => {
    const isIntegerPattern = window.sourcePattern?.patternType === 'integer';
    
    if (isIntegerPattern) {
      return (
        <IntegerPatternZoomWindow
          svgContent={processedSvgContent}
          svgDimensions={svgDimensions}
          boundingBox={window.boundingBox}
          integerPatterns={integerPatterns}
          patternSearchResults={patternSearchResults}
          transformPatternCoordinates={transformPatternCoordinates}
          isPatternWithinBoundingBox={isPatternWithinBoundingBox}
          onPatternClick={handleNestedPatternClick}
          mainViewerZoomScale={mainViewerZoomScale}
          mainViewerZoomEnabled={mainViewerZoomEnabled}
        />
      );
    } else {
      return (
        <GenericPatternZoomWindow
          svgContent={processedSvgContent}
          svgDimensions={svgDimensions}
          boundingBox={window.boundingBox}
          sfPatterns={sfPatterns}
          cwPatterns={cwPatterns}
          integerPatterns={integerPatterns}
          transformPatternCoordinates={transformPatternCoordinates}
          isPatternWithinBoundingBox={isPatternWithinBoundingBox}
          onPatternClick={handleNestedPatternClick}
          mainViewerZoomScale={mainViewerZoomScale}
          mainViewerZoomEnabled={mainViewerZoomEnabled}
          patternCode={patternCode}
          patternType={patternType}
        />
      );
    }
  };

  // Calculate visual styling based on nesting level
  const getWindowStyling = () => {
    const level = window.level || 0;
    const colors = [
      'border-blue-500',
      'border-green-500', 
      'border-orange-500',
      'border-purple-500',
      'border-red-500'
    ];
    const headerColors = [
      'bg-blue-50',
      'bg-green-50',
      'bg-orange-50', 
      'bg-purple-50',
      'bg-red-50'
    ];
    
    return {
      borderColor: colors[level % colors.length],
      headerColor: headerColors[level % headerColors.length],
      title: window.parentId ? `Nested Zoom (Level ${level + 1})` : 'Zoom Window'
    };
  };

  const styling = getWindowStyling();

  return (
    <div 
      key={window.id}
      className={`absolute z-20 bg-white rounded-lg shadow-xl border-2 overflow-hidden ${styling.borderColor}`}
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
        width: `${windowSize.width}px`,
        height: `${windowSize.height}px`,
        resize: 'both',
        transition: 'width 0.3s ease, height 0.3s ease' // Smooth resize animation
      }}
    >
      <div className={`flex items-center justify-between px-3 py-2 cursor-move ${styling.headerColor}`}
        onMouseDown={(e) => {
          e.preventDefault();
          
          // Store initial mouse position
          const startX = e.clientX;
          const startY = e.clientY;
          const startPosX = window.position.x;
          const startPosY = window.position.y;
          
          // Handle mouse move
          const handleMouseMove = (moveEvent: MouseEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            
            handleZoomWindowDrag(window.id, {
              x: startPosX + dx,
              y: startPosY + dy
            });
          };
          
          // Handle mouse up - cleanup
          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };
          
          // Add event listeners
          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      >
        <div className="flex items-center gap-2">
          <Move className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium truncate">
            {styling.title} - {window.boundingBox.title || window.boundingBox.code || 'Figure'}
          </span>
        </div>
        <button 
          className="text-gray-500 hover:text-gray-700"
          onClick={() => removeZoomWindow(window.id)}
          aria-label="Close zoom window"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Zoomed Content */}
      <div className="relative w-full h-[calc(100%-36px)] bg-white overflow-hidden">
        {/* Zoom relationship indicator */}
        <div className="absolute bottom-1 left-1 text-xs text-gray-500 z-10 bg-white/70 px-1 rounded">
          Drag to pan, scroll to zoom
        </div>
        {processedSvgContent && renderZoomWindow()}
      </div>
    </div>
  );
};
