import React from 'react';
import { Loader2, Image, Plus, Save, Trash2, ChevronRight, X, Move } from 'lucide-react';
import { Stage, Layer, Image as KonvaImage, Rect, Group, Transformer, Circle, Text } from 'react-konva';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, RotateCcw, Maximize2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BoundingBox, ZoomWindow } from '@/lib/bounding-box';
import { PDFViewToggle, ViewMode } from './pdf-view-toggle';

interface PDFSVGEditorRenderProps {
  isOpen: boolean;
  handleClose: () => void;
  sheetData?: {
    index: number;
    title?: string;
  };
  navigationStack: Array<{index: number, code: string}>;
  onNavigateToBreadcrumb?: (targetIndex: number) => void;
  isLoading: boolean;
  svgContent: string | null;
  containerRef: React.RefObject<HTMLDivElement>;
  zoomWindows: ZoomWindow[];
  ZoomWindowComponent: React.FC<{
    window: ZoomWindow;
    svgContent: string | null;
    svgDimensions: { width: number; height: number };
    handleZoomWindowDrag: (id: string, newPosition: { x: number; y: number }) => void;
    removeZoomWindow: (id: string) => void;
    sfPatterns?: any[];
    cwPatterns?: any[];
    integerPatterns?: any[];
    transformPatternCoordinates?: (coords: any, svgDimensions?: { width: number; height: number }) => any;
    isPatternWithinBoundingBox?: (patternCoords: any, boundingBox: BoundingBox, transformFn: any) => boolean;
    onPatternClick?: (pattern: any, type: string) => void;
    onNestedPatternClick?: (pattern: any, type: string, parentWindowId: string) => void;
    mainViewerZoomScale?: number;
    mainViewerZoomEnabled?: boolean;
  }>;
  addBoundingBox: () => void;
  saveBoundingBoxes: () => void;
  isSaving: boolean;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleReset: () => void;
  handleFit: () => void;
  stageSize: { width: number, height: number };
  stageRef: React.RefObject<any>;
  stage: { scale: number, x: number, y: number };
  handleWheel: (e: any) => void;
  handleStageDragEnd: (e: any) => void;
  handleStageClick: (e: any) => void;
  svgImage: HTMLImageElement | null;
  svgDimensions: { width: number, height: number };
  visibleBoxes: BoundingBox[];
  selectedBox: string | null;
  createBoxHandlers: (id: string) => any;
  onNavigateToSheet?: (sheetIndex: number, targetBoundingBox?: BoundingBox) => void;
  sheetCodes: any[];
  transformPatternCoordinates: (coords: any, svgDimensions?: { width: number; height: number }) => any;
  sheetMappings: any[];
  createPatternHandlers: (pattern: any, type: string) => any;
  sfPatterns: any[];
  cwPatterns: any[];
  integerPatterns: any[];
  transformerRef: React.RefObject<any>;
  boundingBoxes: BoundingBox[];
  selectedBoxData: BoundingBox | null;
  handleInputUpdate: (id: string, updates: Partial<BoundingBox>) => void;
  deleteBoundingBox: (id: string) => void;
  handleBoxSelect: (id: string) => void;
  handleZoomWindowDrag: (id: string, newPosition: { x: number; y: number }) => void;
  removeZoomWindow: (id: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (view: ViewMode) => void;
  handlePatternClick: (pattern: any, type: string) => void;
  handleNestedPatternClick: (pattern: any, type: string, parentWindowId: string) => void;
  isPatternWithinBoundingBox?: (patternCoords: any, boundingBox: BoundingBox, transformFn: any) => boolean;
  // Area selection props
  handleStageMouseDown?: (e: any) => void;
  handleStageMouseMove?: (e: any) => void;
  handleStageMouseUp?: (e: any) => void;
  isSelecting?: boolean;
  selectionStart?: {x: number, y: number} | null;
  selectionEnd?: {x: number, y: number} | null;
  selectedPatterns?: {sf: any[], cw: any[], integer: any[], sheet: any[]};
  clearSelectedPatterns?: () => void;
  openPatternZoomWindow?: (pattern: any, type: 'sf' | 'cw' | 'sheet' | 'integer') => void;
}

export const PDFSVGEditorRender: React.FC<PDFSVGEditorRenderProps> = ({
  isOpen,
  handleClose,
  sheetData,
  navigationStack,
  onNavigateToBreadcrumb,
  isLoading,
  svgContent,
  containerRef,
  zoomWindows,
  ZoomWindowComponent,
  addBoundingBox,
  saveBoundingBoxes,
  isSaving,
  handleZoomIn,
  handleZoomOut,
  handleReset,
  handleFit,
  stageSize,
  stageRef,
  stage,
  handleWheel,
  handleStageDragEnd,
  handleStageClick,
  svgImage,
  svgDimensions,
  visibleBoxes,
  selectedBox,
  createBoxHandlers,
  onNavigateToSheet,
  sheetCodes,
  transformPatternCoordinates,
  sheetMappings,
  createPatternHandlers,
  sfPatterns,
  cwPatterns,
  integerPatterns,
  transformerRef,
  boundingBoxes,
  selectedBoxData,
  handleInputUpdate,
  deleteBoundingBox,
  handleBoxSelect,
  handleZoomWindowDrag,
  removeZoomWindow,
  viewMode,
  onViewModeChange,
  handlePatternClick,
  handleNestedPatternClick,
  isPatternWithinBoundingBox,
  // Area selection props
  handleStageMouseDown,
  handleStageMouseMove,
  handleStageMouseUp,
  isSelecting,
  selectionStart,
  selectionEnd,
  selectedPatterns,
  clearSelectedPatterns,
  openPatternZoomWindow
}) => {
  console.log('PDF SVG Editor Render - isOpen:', isOpen, 'isLoading:', isLoading, 'svgContent:', !!svgContent);
  
  // If not in modal mode (direct page rendering), render without Dialog wrapper
  if (isOpen) {
    return (
      <div className="w-full h-full flex flex-col min-h-[calc(100vh-4rem)]">
        <div className="px-6 py-4 border-b flex-shrink-0 bg-white">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Image className="w-5 h-5" />
              <h1 className="font-semibold">{sheetData?.title || 'Sheet Viewer'}</h1>
            </div>
            
            {/* Navigation Breadcrumb - Always show when navigation exists or as standalone */}
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-1 text-sm text-gray-600 max-w-lg overflow-hidden">
                {navigationStack.length > 0 ? (
                  <>
                    {navigationStack.map((item) => (
                      <React.Fragment key={`nav-${item.index}`}>
                        <button
                          onClick={() => onNavigateToBreadcrumb?.(item.index)}
                          className="hover:text-blue-600 hover:underline transition-colors whitespace-nowrap"
                        >
                          {item.code}
                        </button>
                        <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      </React.Fragment>
                    ))}
                    <span className="text-gray-900 font-medium whitespace-nowrap">
                      {(() => {
                        const currentSheet = sheetMappings.find(s => s.index === sheetData?.index);
                        return currentSheet?.code || `Sheet ${String(sheetData?.index || 0).padStart(3, '0')}`;
                      })()}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-900 font-medium whitespace-nowrap">
                    {(() => {
                      const currentSheet = sheetMappings.find(s => s.index === sheetData?.index);
                      return currentSheet?.code || `Sheet ${String(sheetData?.index || 0).padStart(3, '0')}`;
                    })()}
                  </span>
                )}
              </div>
            </div>
            
            {/* Back button */}
            <Button variant="ghost" size="sm" onClick={handleClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {isLoading ? (
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p className="text-gray-600">Loading sheet...</p>
                <p className="text-xs text-gray-400 mt-2">Debug: SVG content = {svgContent ? 'Available' : 'Loading...'}</p>
              </div>
            </div>
          ) : svgContent ? (
            <div className="flex w-full h-full flex-1 min-h-[400px]">
              {/* Main Canvas Area */}
              <div className={`flex-1 relative overflow-hidden min-h-[400px] ${viewMode === 'patterns' ? 'bg-gray-50' : ''}`} ref={containerRef}>
                {/* Render the zoom windows */}
                {zoomWindows.map(window => (
                  <ZoomWindowComponent 
                    key={window.id} 
                    window={window} 
                    svgContent={svgContent}
                    svgDimensions={svgDimensions}
                    handleZoomWindowDrag={handleZoomWindowDrag}
                    removeZoomWindow={removeZoomWindow}
                    sfPatterns={sfPatterns}
                    cwPatterns={cwPatterns}
                    integerPatterns={integerPatterns}
                    transformPatternCoordinates={transformPatternCoordinates}
                    isPatternWithinBoundingBox={isPatternWithinBoundingBox}
                    onPatternClick={handlePatternClick}
                    onNestedPatternClick={handleNestedPatternClick}
                    mainViewerZoomScale={stage.scale}
                    mainViewerZoomEnabled={true}
                  />
                ))}

                {/* Toolbar */}
                <div className="absolute top-4 left-4 z-10 flex gap-2 bg-white rounded-lg shadow-lg border p-2">
                  {viewMode === 'edit' && (
                    <>
                      <Button size="sm" variant="outline" onClick={addBoundingBox}>
                        <Plus className="w-4 h-4 mr-1" />
                        Add Box
                      </Button>
                      <Button size="sm" variant="outline" onClick={saveBoundingBoxes} disabled={isSaving}>
                        {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                        Save
                      </Button>
                    </>
                  )}
                </div>

                {/* View Mode Toggle */}
                <PDFViewToggle 
                  currentView={viewMode} 
                  onViewChange={onViewModeChange} 
                />

                {/* Zoom Controls */}
                <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-white rounded-lg shadow-lg border p-2">
                <Button size="sm" variant="outline" onClick={handleZoomIn}>
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={handleZoomOut}>
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={handleReset}>
                  <RotateCcw className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={handleFit}>
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </div>

              {stageSize.width > 0 && stageSize.height > 0 ? (
                <Stage
                  ref={stageRef}
                  width={stageSize.width}
                  height={stageSize.height}
                  scaleX={stage.scale}
                  scaleY={stage.scale}
                  x={stage.x}
                  y={stage.y}
                  onWheel={handleWheel}
                  draggable={viewMode !== 'select'}
                  onDragEnd={handleStageDragEnd}
                  onClick={handleStageClick}
                  onMouseDown={handleStageMouseDown}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={handleStageMouseUp}
                  listening={true}
                  perfectDrawEnabled={false}
                >
                  <Layer>
                    {svgImage && (
                      <KonvaImage
                        image={svgImage}
                        width={svgDimensions.width}
                        height={svgDimensions.height}
                        perfectDrawEnabled={false}
                      />
                    )}
                    
                    {/* Mode Indicator - Small text showing current mode */}
                    {viewMode === 'patterns' && (
                      <Group>
                        <Rect
                          x={10}
                          y={10}
                          width={120}
                          height={24}
                          fill="rgba(16, 185, 129, 0.2)"
                          stroke="rgba(16, 185, 129, 0.5)"
                          strokeWidth={1}
                          cornerRadius={4}
                          perfectDrawEnabled={false}
                        />
                        {/* Text will be added by Konva but not shown in this code representation */}
                      </Group>
                    )}
                    
                    {/* Bounding Boxes - Only render in edit mode or if a box is selected in pattern mode */}
                    {viewMode === 'edit' && visibleBoxes.map((box) => {
                      const handlers = createBoxHandlers(box.id);
                      const isSelected = selectedBox === box.id;
                      
                      return (
                        <Group key={box.id}>
                          <Rect
                            id={box.id}
                            x={box.x}
                            y={box.y}
                            width={box.width}
                            height={box.height}
                            fill={isSelected ? `${box.color}40` : `${box.color}20`}
                            stroke={box.color}
                            strokeWidth={2}
                            draggable={!isSelected}
                            onClick={handlers.onClick}
                            onDragStart={handlers.onDragStart}
                            onDragMove={handlers.onDragMove}
                            onDragEnd={handlers.onDragEnd}
                            onTransformEnd={handlers.onTransformEnd}
                            strokeScaleEnabled={false}
                            perfectDrawEnabled={false}
                            shadowForStrokeEnabled={false}
                          />
                        </Group>
                      );
                    })}

                    {/* Sheet Code Navigation Buttons - Blue Circles */}
                    {onNavigateToSheet && sheetCodes.map((sheetCode) => {
                      const buttonId = `sheet-pattern-${sheetCode.index}-${sheetCode.text}`;
                      // In patterns view, show all patterns. In edit view, hide them. In select mode, show all patterns
                      const isVisible = viewMode === 'patterns' || viewMode === 'select';
                      
                      if (!isVisible) return null;
                      
                      const coords = transformPatternCoordinates(sheetCode.coordinates, svgDimensions);
                      const sheet = sheetMappings.find(s => s.code === sheetCode.text);
                      
                      const buttonRadius = Math.max(Math.min(Math.min(coords.width, coords.height) * 0.4, 12), 6);
                      const centerX = coords.x;
                      const centerY = coords.y;
                      
                      return (
                        <Group key={`sheet-code-${sheetCode.index}-${sheetCode.text}`}>
                          {/* Outer ring */}
                          <Circle
                            x={centerX}
                            y={centerY}
                            radius={buttonRadius}
                            fill={sheet ? '#3b82f6' : '#9ca3af'}
                            stroke={sheet ? '#1d4ed8' : '#6b7280'}
                            strokeWidth={2}
                            opacity={0.7}
                            onClick={createPatternHandlers(sheetCode, 'sheet').onClick}
                            perfectDrawEnabled={false}
                          />
                          {/* Inner dot */}
                          <Circle
                            x={centerX}
                            y={centerY}
                            radius={buttonRadius * 0.3}
                            fill="white"
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        </Group>
                      );
                    })}

                    {/* SF Pattern Buttons - Green Squares */}
                    {sfPatterns.map((sfPattern) => {
                      const buttonId = `sf-pattern-${sfPattern.index}-${sfPattern.text}`;
                      // In patterns view, show all patterns. In edit view, hide them. In select mode, show all patterns
                      const isVisible = viewMode === 'patterns' || viewMode === 'select';
                      
                      if (!isVisible) return null;
                      
                      const coords = transformPatternCoordinates(sfPattern.coordinates, svgDimensions);
                      
                      const buttonSize = Math.max(Math.min(Math.min(coords.width, coords.height) * 0.8, 20), 10);
                      // Using raw coordinates for the center point calculation to test if this helps
                      const centerX = coords.x;
                      const centerY = coords.y;
                      
                      return (
                        <Group key={`sf-pattern-${sfPattern.index}-${sfPattern.text}`}>
                          {/* Outer square */}
                          <Rect
                            x={centerX - buttonSize / 2}
                            y={centerY - buttonSize / 2}
                            width={buttonSize}
                            height={buttonSize}
                            fill="#10b981"
                            stroke="#059669"
                            strokeWidth={2}
                            opacity={0.7}
                            onClick={createPatternHandlers(sfPattern, 'sf').onClick}
                            perfectDrawEnabled={false}
                          />
                          {/* Inner square */}
                          <Rect
                            x={centerX - buttonSize / 4}
                            y={centerY - buttonSize / 4}
                            width={buttonSize / 2}
                            height={buttonSize / 2}
                            fill="white"
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        </Group>
                      );
                    })}

                    {/* CW Pattern Buttons - Orange Triangles */}
                    {cwPatterns.map((cwPattern) => {
                      const buttonId = `cw-pattern-${cwPattern.index}-${cwPattern.text}`;
                      // In patterns view, show all patterns. In edit view, hide them. In select mode, show all patterns
                      const isVisible = viewMode === 'patterns' || viewMode === 'select';
                      
                      if (!isVisible) return null;
                      
                      const coords = transformPatternCoordinates(cwPattern.coordinates, svgDimensions);
                      
                      const buttonSize = Math.max(Math.min(Math.min(coords.width, coords.height) * 0.8, 20), 10);
                      const centerX = coords.x;
                      const centerY = coords.y ;
                      
                      // For CW patterns, using orange squares for simplicity
                      
                      return (
                        <Group key={`cw-pattern-${cwPattern.index}-${cwPattern.text}`}>
                          {/* Outer triangle */}
                          <Rect
                            x={centerX - buttonSize / 2}
                            y={centerY - buttonSize / 2}
                            width={buttonSize}
                            height={buttonSize}
                            fill="#f97316"
                            stroke="#ea580c"
                            strokeWidth={2}
                            opacity={0.7}
                            onClick={createPatternHandlers(cwPattern, 'cw').onClick}
                            perfectDrawEnabled={false}
                          />
                          {/* Inner diamond/dot */}
                          <Circle
                            x={centerX}
                            y={centerY}
                            radius={buttonSize * 0.15}
                            fill="white"
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        </Group>
                      );
                    })}

                    {/* Integer Pattern Buttons - Purple Diamonds */}
                    {integerPatterns?.map((integerPattern) => {
                      const buttonId = `integer-pattern-${integerPattern.index}-${integerPattern.text}`;
                      // In patterns view, show all patterns. In edit view, hide them. In select mode, show all patterns
                      const isVisible = viewMode === 'patterns' || viewMode === 'select';
                      
                      if (!isVisible) return null;
                      
                      const coords = transformPatternCoordinates(integerPattern.coordinates, svgDimensions);
                      
                      const buttonSize = Math.max(Math.min(Math.min(coords.width, coords.height) * 0.8, 20), 10);
                      const centerX = coords.x;
                      const centerY = coords.y;
                      
                      return (
                        <Group key={`integer-pattern-${integerPattern.index}-${integerPattern.text}`}>
                          {/* Outer diamond (rotated square) */}
                          <Rect
                            x={centerX - buttonSize / 2}
                            y={centerY - buttonSize / 2}
                            width={buttonSize}
                            height={buttonSize}
                            fill="#9333ea"
                            stroke="#7c3aed"
                            strokeWidth={2}
                            opacity={0.7}
                            rotation={45}
                            onClick={createPatternHandlers(integerPattern, 'integer').onClick}
                            perfectDrawEnabled={false}
                          />
                          {/* Inner diamond (smaller rotated square) */}
                          <Rect
                            x={centerX - buttonSize / 4}
                            y={centerY - buttonSize / 4}
                            width={buttonSize / 2}
                            height={buttonSize / 2}
                            fill="white"
                            rotation={45}
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        </Group>
                      );
                    })}
                    
                    {selectedBox && viewMode === 'edit' && (
                      <Transformer
                        ref={transformerRef}
                        enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'middle-left', 'middle-right', 'bottom-center']}
                        rotateEnabled={false}
                        anchorSize={8}
                        keepRatio={false}
                        resizeEnabled={true}
                        useSingleNodeRotation={false}
                        flipEnabled={false}
                        centeredScaling={false}
                        ignoreStroke={true}
                        borderEnabled={true}
                        borderStroke="#2563eb"
                        borderStrokeWidth={2}
                        anchorStroke="#2563eb"
                        anchorFill="#ffffff"
                        anchorCornerRadius={2}
                        shouldOverdrawWholeArea={true}
                        boundBoxFunc={(oldBox, newBox) => {
                          // Prevent boxes from becoming too small
                          if (newBox.width < 10 || newBox.height < 10) {
                            return oldBox;
                          }
                          return newBox;
                        }}
                      />
                    )}

                    {/* Area Selection Rectangle */}
                    {viewMode === 'select' && isSelecting && selectionStart && selectionEnd && (
                      <Rect
                        x={Math.min(selectionStart.x, selectionEnd.x)}
                        y={Math.min(selectionStart.y, selectionEnd.y)}
                        width={Math.abs(selectionEnd.x - selectionStart.x)}
                        height={Math.abs(selectionEnd.y - selectionStart.y)}
                        fill="rgba(59, 130, 246, 0.1)"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dash={[10, 5]}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    )}

                    {/* Highlight Selected Patterns */}
                    {viewMode === 'select' && selectedPatterns && (
                      <>
                        {/* Highlight selected SF patterns */}
                        {selectedPatterns.sf.map((pattern) => {
                          const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
                          const buttonSize = Math.max(Math.min(Math.min(coords.width, coords.height) * 0.8, 20), 10);
                          return (
                            <Rect
                              key={`selected-sf-${pattern.index}`}
                              x={coords.x - buttonSize / 2 - 5}
                              y={coords.y - buttonSize / 2 - 5}
                              width={buttonSize + 10}
                              height={buttonSize + 10}
                              fill="rgba(16, 185, 129, 0.2)"
                              stroke="#10b981"
                              strokeWidth={3}
                              listening={false}
                              perfectDrawEnabled={false}
                            />
                          );
                        })}

                        {/* Highlight selected CW patterns */}
                        {selectedPatterns.cw.map((pattern) => {
                          const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
                          const buttonSize = Math.max(Math.min(Math.min(coords.width, coords.height) * 0.8, 20), 10);
                          return (
                            <Rect
                              key={`selected-cw-${pattern.index}`}
                              x={coords.x - buttonSize / 2 - 5}
                              y={coords.y - buttonSize / 2 - 5}
                              width={buttonSize + 10}
                              height={buttonSize + 10}
                              fill="rgba(249, 115, 22, 0.2)"
                              stroke="#f97316"
                              strokeWidth={3}
                              listening={false}
                              perfectDrawEnabled={false}
                            />
                          );
                        })}

                        {/* Highlight selected integer patterns */}
                        {selectedPatterns.integer.map((pattern) => {
                          const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
                          const buttonSize = Math.max(Math.min(Math.min(coords.width, coords.height) * 0.8, 20), 10);
                          return (
                            <Rect
                              key={`selected-int-${pattern.index}`}
                              x={coords.x - buttonSize / 2 - 5}
                              y={coords.y - buttonSize / 2 - 5}
                              width={buttonSize + 10}
                              height={buttonSize + 10}
                              fill="rgba(139, 69, 19, 0.2)"
                              stroke="#8b4513"
                              strokeWidth={3}
                              listening={false}
                              perfectDrawEnabled={false}
                            />
                          );
                        })}

                        {/* Highlight selected sheet codes */}
                        {selectedPatterns.sheet.map((pattern) => {
                          const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
                          const buttonRadius = Math.max(Math.min(Math.min(coords.width, coords.height) * 0.4, 12), 6);
                          return (
                            <Circle
                              key={`selected-sheet-${pattern.index}`}
                              x={coords.x}
                              y={coords.y}
                              radius={buttonRadius + 5}
                              fill="rgba(59, 130, 246, 0.2)"
                              stroke="#3b82f6"
                              strokeWidth={3}
                              listening={false}
                              perfectDrawEnabled={false}
                            />
                          );
                        })}
                      </>
                    )}
                  </Layer>
                </Stage>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                    <p className="text-gray-600">Preparing canvas...</p>
                  </div>
                </div>
              )}
              </div>

              {/* Properties Panel - Only show in edit mode */}
              {viewMode === 'edit' && (
                <div className="fixed top-0 right-0 w-80 h-full bg-white border-l overflow-auto z-30">
                  <div className="p-4 border-b bg-gray-50">
                    <h3 className="font-semibold text-gray-900">Bounding Boxes</h3>
                    <p className="text-xs text-gray-500 mt-1">{boundingBoxes.length} boxes</p>
                  </div>
                  
                  <div className="p-4 space-y-4">
                    {/* Selected Box Properties */}
                    {selectedBoxData && (
                      <div className="border rounded-lg p-3 bg-blue-50">
                        <h4 className="font-medium text-sm mb-3">Selected Box</h4>
                        
                        <div className="space-y-3">
                          <div>
                            <Label htmlFor="code" className="text-xs">Code</Label>
                            <Input
                              id="code"
                              value={selectedBoxData.code || ''}
                              onChange={(e) => handleInputUpdate(selectedBoxData.id, { code: e.target.value })}
                              className="h-8 text-xs"
                              placeholder="Enter code..."
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor="title" className="text-xs">Title</Label>
                            <Input
                              id="title"
                              value={selectedBoxData.title || ''}
                              onChange={(e) => handleInputUpdate(selectedBoxData.id, { title: e.target.value })}
                              className="h-8 text-xs"
                              placeholder="Enter title..."
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor="content" className="text-xs">Content</Label>
                            <textarea
                              id="content"
                              value={selectedBoxData.content || ''}
                              onChange={(e) => handleInputUpdate(selectedBoxData.id, { content: e.target.value })}
                              className="w-full h-16 text-xs border border-gray-300 rounded px-2 py-1 resize-none"
                              placeholder="Enter content..."
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor="type" className="text-xs">Type</Label>
                            <select
                              id="type"
                              value={selectedBoxData.type}
                              onChange={(e) => {
                                const type = e.target.value as 'figure' | 'table' | 'text';
                                const colors = { figure: '#FF5722', table: '#4CAF50', text: '#2196F3' };
                                handleInputUpdate(selectedBoxData.id, { type, color: colors[type] });
                              }}
                              className="w-full h-8 text-xs border border-gray-300 rounded px-2"
                            >
                              <option value="text">Text</option>
                              <option value="figure">Figure</option>
                              <option value="table">Table</option>
                            </select>
                          </div>
                          
                          <div>
                            <Label htmlFor="shape" className="text-xs">Shape</Label>
                            <select
                              id="shape"
                              value={selectedBoxData.shape || 'rectangle'}
                              onChange={(e) => {
                                const shape = e.target.value as 'circle' | 'square' | 'rectangle' | 'hexagon' | 'other' | 'none';
                                handleInputUpdate(selectedBoxData.id, { shape });
                              }}
                              className="w-full h-8 text-xs border border-gray-300 rounded px-2"
                            >
                              <option value="none">None</option>
                              <option value="rectangle">Rectangle</option>
                              <option value="square">Square</option>
                              <option value="circle">Circle</option>
                              <option value="hexagon">Hexagon</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor="x" className="text-xs">X</Label>
                              <Input
                                id="x"
                                type="number"
                                value={Math.round(selectedBoxData.x)}
                                onChange={(e) => handleInputUpdate(selectedBoxData.id, { x: parseInt(e.target.value) || 0 })}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div>
                              <Label htmlFor="y" className="text-xs">Y</Label>
                              <Input
                                id="y"
                                type="number"
                                value={Math.round(selectedBoxData.y)}
                                onChange={(e) => handleInputUpdate(selectedBoxData.id, { y: parseInt(e.target.value) || 0 })}
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor="width" className="text-xs">Width</Label>
                              <Input
                                id="width"
                                type="number"
                                value={Math.round(selectedBoxData.width)}
                                onChange={(e) => handleInputUpdate(selectedBoxData.id, { width: parseInt(e.target.value) || 10 })}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div>
                              <Label htmlFor="height" className="text-xs">Height</Label>
                              <Input
                                id="height"
                                type="number"
                                value={Math.round(selectedBoxData.height)}
                                onChange={(e) => handleInputUpdate(selectedBoxData.id, { height: parseInt(e.target.value) || 10 })}
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="text-xs text-center text-gray-500 p-2 border rounded-md bg-gray-50">
                              <div className="flex items-center justify-center gap-1 mb-1">
                                <ZoomIn className="w-3 h-3" />
                                <span className="font-medium">Auto-Scan Active</span>
                              </div>
                              <p>Patterns are automatically detected in this bounding box</p>
                            </div>
                            
                            <Button
                              onClick={() => deleteBoundingBox(selectedBoxData.id)}
                              variant="destructive"
                              size="sm"
                              className="w-full h-8 text-xs"
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Box List */}
                    <div>
                      <h4 className="font-medium text-sm mb-2">All Boxes</h4>
                      <div className="space-y-1 max-h-96 overflow-auto">
                        {boundingBoxes.map((box) => (
                          <div
                            key={box.id}
                            className={`p-2 border rounded text-xs cursor-pointer transition-colors ${
                              selectedBox === box.id
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                            onClick={() => handleBoxSelect(box.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <div
                                  className="w-3 h-3 rounded"
                                  style={{ backgroundColor: box.color }}
                                />
                                <span className="font-medium">{box.title || box.code || 'Untitled'}</span>
                              </div>
                              <span className="text-gray-500 text-xs">{box.type}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Selected Patterns Panel - Show in select mode when patterns are selected */}
          {viewMode === 'select' && selectedPatterns && (
            selectedPatterns.sf.length > 0 || 
            selectedPatterns.cw.length > 0 || 
            selectedPatterns.integer.length > 0 || 
            selectedPatterns.sheet.length > 0
          ) && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 w-96 max-w-[90vw] z-20">
              <div className="bg-white rounded-lg shadow-xl border p-4 max-h-[60vh] overflow-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm">Selected Patterns</h3>
                  <div className="flex items-center gap-3">
                    <div className="text-xs text-gray-500">
                      {selectedPatterns.sf.length + selectedPatterns.cw.length + selectedPatterns.integer.length + selectedPatterns.sheet.length} patterns
                    </div>
                    <button 
                      onClick={clearSelectedPatterns}
                      className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                
                {/* SF Patterns */}
                {selectedPatterns.sf.length > 0 && (
                  <div className="mb-3">
                    <h4 className="font-medium text-xs text-green-700 mb-2">SF Patterns ({selectedPatterns.sf.length})</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedPatterns.sf.map((pattern) => (
                        <button
                          key={`selected-sf-${pattern.index}`}
                          onClick={() => openPatternZoomWindow?.(pattern, 'sf')}
                          className="p-2 bg-green-50 border border-green-200 rounded text-xs hover:bg-green-100 transition-colors text-left"
                        >
                          <div className="font-medium">{pattern.text || `SF ${pattern.index}`}</div>
                          <div className="text-gray-500 text-xs">Index: {pattern.index}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* CW Patterns */}
                {selectedPatterns.cw.length > 0 && (
                  <div className="mb-3">
                    <h4 className="font-medium text-xs text-orange-700 mb-2">CW Patterns ({selectedPatterns.cw.length})</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedPatterns.cw.map((pattern) => (
                        <button
                          key={`selected-cw-${pattern.index}`}
                          onClick={() => openPatternZoomWindow?.(pattern, 'cw')}
                          className="p-2 bg-orange-50 border border-orange-200 rounded text-xs hover:bg-orange-100 transition-colors text-left"
                        >
                          <div className="font-medium">{pattern.text || `CW ${pattern.index}`}</div>
                          <div className="text-gray-500 text-xs">Index: {pattern.index}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Integer Patterns */}
                {selectedPatterns.integer.length > 0 && (
                  <div className="mb-3">
                    <h4 className="font-medium text-xs text-amber-700 mb-2">Integer Patterns ({selectedPatterns.integer.length})</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedPatterns.integer.map((pattern) => (
                        <button
                          key={`selected-int-${pattern.index}`}
                          onClick={() => openPatternZoomWindow?.(pattern, 'integer')}
                          className="p-2 bg-amber-50 border border-amber-200 rounded text-xs hover:bg-amber-100 transition-colors text-left"
                        >
                          <div className="font-medium">{pattern.text || `Int ${pattern.index}`}</div>
                          <div className="text-gray-500 text-xs">Index: {pattern.index}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sheet Codes */}
                {selectedPatterns.sheet.length > 0 && (
                  <div className="mb-3">
                    <h4 className="font-medium text-xs text-blue-700 mb-2">Sheet Codes ({selectedPatterns.sheet.length})</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedPatterns.sheet.map((pattern) => (
                        <button
                          key={`selected-sheet-${pattern.index}`}
                          onClick={() => openPatternZoomWindow?.(pattern, 'sheet')}
                          className="p-2 bg-blue-50 border border-blue-200 rounded text-xs hover:bg-blue-100 transition-colors text-left"
                        >
                          <div className="font-medium">{pattern.text || `Sheet ${pattern.index}`}</div>
                          <div className="text-gray-500 text-xs">Index: {pattern.index}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-gray-200">
                  <div className="text-xs text-gray-600 mb-3 text-center">
                    Click individual patterns or use the button below to open all
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        // Open all selected patterns as zoom windows
                        selectedPatterns.sf.forEach(p => openPatternZoomWindow?.(p, 'sf'));
                        selectedPatterns.cw.forEach(p => openPatternZoomWindow?.(p, 'cw'));  
                        selectedPatterns.integer.forEach(p => openPatternZoomWindow?.(p, 'integer'));
                        selectedPatterns.sheet.forEach(p => openPatternZoomWindow?.(p, 'sheet'));
                      }}
                      className="flex-1 py-2 px-3 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition-colors"
                    >
                      Open All ({selectedPatterns.sf.length + selectedPatterns.cw.length + selectedPatterns.integer.length + selectedPatterns.sheet.length})
                    </button>
                    <button 
                      onClick={clearSelectedPatterns}
                      className="py-2 px-3 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Fallback - if not open, return null
  return null;
};
