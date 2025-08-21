'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ZoomWindowComponent } from './zoom-window-component';
import { PDFViewToggle, ViewMode } from './pdf-view-toggle';

// Import from bounding-box module
import { 
  BoundingBox, 
  loadBoundingBoxes as fetchBoundingBoxes,
  saveBoundingBoxes as saveBoundingBoxesToAPI,
  updateBoundingBox as updateBoundingBoxAPI,
  findBoundingBoxInSheet as findBoundingBoxInSheetAPI,
  searchBoundingBoxAcrossSheets as searchBoundingBoxAcrossSheetsAPI,
  transformPatternCoordinates as transformPatternCoordinates,
  isPatternWithinBoundingBox as isPatternWithinBox,
  getVisibleBounds,
  getVisibleBoxes,
  createBoundingBox,
  createBoxHandlers
} from '@/lib/bounding-box';

// Import types from bounding-box module
import type { ZoomWindow } from '@/lib/bounding-box';

interface ZoomConfig {
  scale: number;
  x: number;
  y: number;
}

interface PDFSVGEditorProps {
  isOpen: boolean;
  onClose: () => void;
  pdfPath?: string;
  pdfFile?: File;
  svgContent?: string; // Direct SVG content
  pageNumber?: number; // For specific page in multi-page PDF
  sheetData?: {
    index: number;
    title?: string;
  };
  onNavigateToSheet?: (sheetIndex: number, targetBoundingBox?: BoundingBox) => void;
  navigationStack?: Array<{index: number, code: string}>;
  onNavigateToBreadcrumb?: (targetIndex: number) => void;
  onGoBack?: () => void;
  targetBoundingBox?: BoundingBox; // Bounding box to zoom to when sheet loads
  restoreZoomConfig?: ZoomConfig | null; // Zoom config to restore
  onZoomConfigChange?: (zoomConfig: ZoomConfig) => void; // Callback to report zoom changes
}

export function PDFSVGEditor({
  isOpen,
  onClose,
  pdfPath,
  pdfFile,
  svgContent: providedSvgContent,
  pageNumber = 0,
  sheetData,
  onNavigateToSheet,
  navigationStack = [],
  onNavigateToBreadcrumb,
  onGoBack,
  targetBoundingBox,
  restoreZoomConfig,
  onZoomConfigChange
}: PDFSVGEditorProps) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [stage, setStage] = useState({ scale: 0.5, x: 0, y: 0 });
  const [svgImage, setSvgImage] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [svgDimensions, setSvgDimensions] = useState({ width: 3024, height: 2160 });
  const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[]>([]);
  const [selectedBox, setSelectedBox] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sheetCodes, setSheetCodes] = useState<any[]>([]);
  const [sfPatterns, setSfPatterns] = useState<any[]>([]);
  const [cwPatterns, setCwPatterns] = useState<any[]>([]);
  const [integerPatterns, setIntegerPatterns] = useState<any[]>([]);
  const [sheetMappings, setSheetMappings] = useState<any[]>([]);
  const [hasUsedTargetBoundingBox, setHasUsedTargetBoundingBox] = useState(false);
  const [zoomWindows, setZoomWindows] = useState<ZoomWindow[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('patterns');
  
  // Area selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{x: number, y: number} | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{x: number, y: number} | null>(null);
  const [selectedPatterns, setSelectedPatterns] = useState<{sf: any[], cw: any[], integer: any[], sheet: any[]}>({sf: [], cw: [], integer: [], sheet: []});
  
  const containerRef = React.useRef<HTMLDivElement>(null);
  const transformerRef = useRef<any>(null);
  const stageRef = useRef<any>(null);

  // Refs for debounced saves
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Coordinate transformation functions
  const transformChunkrToSvg = useCallback((box: any, svgDimensions: { width: number; height: number }) => {
    if (!box.pageWidth || !box.pageHeight) {
      // No Chunkr dimensions, assume coordinates are already in SVG space
      console.log('No Chunkr dimensions, using coordinates as-is:', box);
      return box;
    }
    
    const scaleX = svgDimensions.width / box.pageWidth;
    const scaleY = svgDimensions.height / box.pageHeight;
    
    const transformed = {
      ...box,
      x: box.x * scaleX,
      y: box.y * scaleY,
      width: box.width * scaleX,
      height: box.height * scaleY
    };
    
    console.log('Chunkr→SVG transform:', {
      original: { x: box.x, y: box.y, w: box.width, h: box.height },
      scales: { scaleX, scaleY },
      chunkrDims: { w: box.pageWidth, h: box.pageHeight },
      svgDims: svgDimensions,
      transformed: { x: transformed.x, y: transformed.y, w: transformed.width, h: transformed.height }
    });
    
    return transformed;
  }, []);

  const transformSvgToChunkr = useCallback((svgCoords: any, pageWidth: number, pageHeight: number, svgDimensions: { width: number; height: number }) => {
    const scaleX = pageWidth / svgDimensions.width;
    const scaleY = pageHeight / svgDimensions.height;
    
    const transformed = {
      x: svgCoords.x * scaleX,
      y: svgCoords.y * scaleY,
      width: svgCoords.width * scaleX,
      height: svgCoords.height * scaleY
    };
    
    console.log('SVG→Chunkr transform:', {
      original: { x: svgCoords.x, y: svgCoords.y, w: svgCoords.width, h: svgCoords.height },
      scales: { scaleX, scaleY },
      chunkrDims: { w: pageWidth, h: pageHeight },
      svgDims: svgDimensions,
      transformed: { x: transformed.x, y: transformed.y, w: transformed.width, h: transformed.height }
    });
    
    return transformed;
  }, []);

  // Handler for pattern clicks in zoom windows
  const handlePatternClick = useCallback((pattern: any, type: string) => {
    
    // Try to extract a sheet code from the pattern
    let sheetCode = null;
    let additionalTextToMatch = null;
    
    // If the pattern has a direct sheetIndex property, use that
    if (pattern.sheetIndex !== undefined) {
      onNavigateToSheet?.(pattern.sheetIndex, undefined);
      return;
    }
    
    // Check for extractedSheetCode first (from enhanced pattern data)
    if (pattern.extractedSheetCode) {
      sheetCode = pattern.extractedSheetCode;
    }
    // For sheet codes, check if there's additional text that might be a bounding box code
    else if (type === 'sheet' && pattern.shape_analysis?.additional_text?.length > 0) {
      sheetCode = pattern.text;
      additionalTextToMatch = pattern.shape_analysis.additional_text;
    }
    else if (type === 'sheet') {
    }
    // Extract potential sheet code from the pattern text or code
    else if (pattern.text) {
      
      // Try all common sheet code formats
      const regexPatterns = [
        /[A-Z]-\d+/,            // S-101
        /[A-Z]\d+\.\d+/,        // A1.02
        /[A-Z]-\d+\.\d+/,       // S-1.01
        /[A-Z]-\d+[A-Z]/,       // S-101H
        /[A-Z]-\d+\.\d+[A-Z]/   // S-1.01H
      ];
      
      let found = false;
      for (const regex of regexPatterns) {
        const matches = pattern.text.match(regex);
        if (matches && matches.length > 0) {
          sheetCode = matches[0];
          found = true;
          break;
        }
      }
      
      if (!found) {
        // Special case for references to structural sheets which often start with "S-"
        if (pattern.text.toLowerCase().includes('s-') || 
            pattern.text.toLowerCase().includes('structural') || 
            pattern.text.toLowerCase().includes('struct')) {
          
          // Try to find structural sheets (codes starting with S-)
          const structuralSheets = sheetMappings.filter(mapping => 
            mapping.code && mapping.code.startsWith('S-')
          );
          
          if (structuralSheets.length > 0) {
            // Use the first structural sheet as fallback
            const firstStructSheet = structuralSheets[0];
            onNavigateToSheet?.(firstStructSheet.index, undefined);
            return;
          }
        }
        
        // If no regex matched and no special case applied, use the entire text as fallback
        sheetCode = pattern.text;
      }
    }
    
    // If pattern doesn't have a text, try to use the pattern code
    if (!sheetCode && pattern.code) {
      sheetCode = pattern.code;
    }
    
    if (sheetCode) {
      
      // Try different ways to match the sheet code
      // 1. Direct case-insensitive comparison
      let targetSheet = sheetMappings.find((mapping: any) => 
        mapping.code && mapping.code.toLowerCase() === sheetCode.toLowerCase()
      );
      
      // 2. Try without the 'H' suffix which is sometimes present in codes
      if (!targetSheet && sheetCode.endsWith('H')) {
        const codeWithoutH = sheetCode.slice(0, -1);
        targetSheet = sheetMappings.find((mapping: any) => 
          mapping.code && mapping.code.toLowerCase() === codeWithoutH.toLowerCase()
        );
      }
      
      // 3. Try checking if the sheet code is contained within mapping code
      if (!targetSheet) {
        targetSheet = sheetMappings.find((mapping: any) => 
          mapping.code && (
            mapping.code.toLowerCase().includes(sheetCode.toLowerCase()) ||
            sheetCode.toLowerCase().includes(mapping.code.toLowerCase())
          )
        );
      }
      
      // 4. Try to extract and match just the number part
      if (!targetSheet) {
        const numberMatch = sheetCode.match(/\d+\.?\d*/);
        if (numberMatch && numberMatch.length > 0) {
          const numberPart = numberMatch[0];
          targetSheet = sheetMappings.find((mapping: any) => 
            mapping.code && mapping.code.includes(numberPart)
          );
        }
      }
      
      // 5. Try to match just the first few characters of the code
      if (!targetSheet && sheetCode.length > 3) {
        const codePrefix = sheetCode.substring(0, 3);
        targetSheet = sheetMappings.find((mapping: any) => 
          mapping.code && mapping.code.toLowerCase().startsWith(codePrefix.toLowerCase())
        );
      }
      
      // 6. Special case for patterns that might just contain sheet numbers
      if (!targetSheet) {
        // Try to extract a number that might be a sheet index
        const numberMatch = pattern.text?.match(/\b(\d+)\b/);
        if (numberMatch && numberMatch.length > 0) {
          const potentialIndex = parseInt(numberMatch[0], 10);
          
          // Check if this number corresponds to a valid sheet index
          if (potentialIndex >= 0 && potentialIndex < sheetMappings.length) {
            targetSheet = sheetMappings[potentialIndex];
          }
        }
      }
      
      if (targetSheet && targetSheet.index !== undefined) {
        
        // If we have additional text, try to find a matching bounding box on the target sheet
        let targetBoundingBox = undefined;
        if (additionalTextToMatch && additionalTextToMatch.length > 0) {
          
          // First, try to find a bounding box with exact code match
          for (const additionalText of additionalTextToMatch) {
            const foundBox = boundingBoxes.find(box => 
              box.code && box.code.toLowerCase() === additionalText.toLowerCase()
            );
            if (foundBox) {
              targetBoundingBox = foundBox;
              break;
            } else {
            }
          }
          
          // If no exact match, try partial matches
          if (!targetBoundingBox) {
            for (const additionalText of additionalTextToMatch) {
              const foundBox = boundingBoxes.find(box => 
                box.code && (
                  box.code.toLowerCase().includes(additionalText.toLowerCase()) ||
                  additionalText.toLowerCase().includes(box.code.toLowerCase())
                )
              );
              if (foundBox) {
                targetBoundingBox = foundBox;
                break;
              } else {
              }
            }
          }
          
          if (!targetBoundingBox) {
          }
          
          // If we're on the same sheet as the target, zoom to the bounding box directly
          if (targetSheet.index === sheetData?.index && targetBoundingBox) {
            // Don't navigate, just zoom to the bounding box on current sheet
            // This would require additional logic to zoom to the bounding box
            setSelectedBox(targetBoundingBox.id);
            return;
          }
        }
        
        onNavigateToSheet?.(targetSheet.index, targetBoundingBox);
      } else {
      }
    } else {
    }
  }, [onNavigateToSheet, sheetMappings, boundingBoxes, sheetData?.index, setSelectedBox]);

  useEffect(() => {
    if (isOpen && (pdfPath || pdfFile || providedSvgContent) && sheetData) {
      loadSVG();
      loadSheetCodes();
      loadSheetMappings();
    }
  }, [isOpen, pdfPath, pdfFile, providedSvgContent, pageNumber, sheetData?.index]);

  // Load bounding boxes when SVG dimensions are available
  useEffect(() => {
    if (isOpen && sheetData && svgDimensions.width > 0 && svgDimensions.height > 0) {
      console.log('Loading bounding boxes with SVG dimensions:', svgDimensions);
      loadBoundingBoxes();
    }
  }, [isOpen, sheetData?.index, svgDimensions.width, svgDimensions.height]);

  // Convert SVG to image for Konva - also handle provided SVG content
  useEffect(() => {
    if (svgContent) {
      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      const img = new window.Image();
      img.onload = () => {
        setSvgImage(img);
        URL.revokeObjectURL(url);
        
        // Extract ACTUAL SVG dimensions from content
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
        const svgElement = svgDoc.querySelector('svg');
        
        if (svgElement) {
          const width = parseFloat(svgElement.getAttribute('width') || '3024');
          const height = parseFloat(svgElement.getAttribute('height') || '2160');
          setSvgDimensions({ width, height });
          console.log('Extracted SVG dimensions:', { width, height });
          console.log('SVG element attributes:', {
            width: svgElement.getAttribute('width'),
            height: svgElement.getAttribute('height'),
            viewBox: svgElement.getAttribute('viewBox')
          });
        } else {
          console.warn('No SVG element found, using default dimensions');
          setSvgDimensions({ width: 3024, height: 2160 });
        }
      };
      img.src = url;
    }
  }, [svgContent]);

  // Ensure provided SVG content is processed immediately
  useEffect(() => {
    if (providedSvgContent && !svgContent) {
      setSvgContent(providedSvgContent);
      console.log('Set provided SVG content:', !!providedSvgContent);
    }
  }, [providedSvgContent, svgContent]);

  // Handle container resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current && isOpen) {
        const rect = containerRef.current.getBoundingClientRect();
        const newWidth = Math.floor(rect.width);
        const newHeight = Math.floor(rect.height);
        
        console.log('Container size measurement:', { width: newWidth, height: newHeight, rect });
        
        // Only update if there's a meaningful change and size is valid
        if (newWidth > 0 && newHeight > 0) {
          setStageSize({ width: newWidth, height: newHeight });
          console.log('Stage size updated:', { width: newWidth, height: newHeight });
        } else {
          console.warn('Invalid container dimensions:', { width: newWidth, height: newHeight });
        }
      }
    };

    if (isOpen) {
      // Multiple attempts to get the correct size
      const timeouts = [50, 200, 500, 1000].map(delay => 
        setTimeout(updateSize, delay)
      );
      
      const resizeObserver = new ResizeObserver(updateSize);
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
      
      window.addEventListener('resize', updateSize);
      
      return () => {
        timeouts.forEach(clearTimeout);
        resizeObserver.disconnect();
        window.removeEventListener('resize', updateSize);
      };
    }
  }, [isOpen]);

  const loadSVG = async () => {
    console.log('loadSVG called - providedSvgContent:', !!providedSvgContent, 'pdfFile:', !!pdfFile, 'pdfPath:', !!pdfPath);
    setIsLoading(true);
    try {
      // If we have direct SVG content, use it
      if (providedSvgContent) {
        console.log('Using provided SVG content');
        setSvgContent(providedSvgContent);
        // Extract dimensions from SVG if possible
        const svgMatch = providedSvgContent.match(/width="(\d+)".*?height="(\d+)"/);
        if (svgMatch) {
          setSvgDimensions({ width: parseInt(svgMatch[1]), height: parseInt(svgMatch[2]) });
        }
      }
      // If we have a file, convert it to SVG
      else if (pdfFile) {
        console.warn('PDF file upload feature not available - using mock SVG');
        setSvgContent(createMockSVG());
      } 
      // If we have a path, fetch the SVG
      else if (pdfPath) {
        console.log('Fetching SVG from path:', pdfPath);
        const svgPath = pdfPath.replace('.pdf', '.svg');
        const response = await fetch(`http://localhost:8080${svgPath}`);
        
        if (response.ok) {
          const content = await response.text();
          setSvgContent(content);
        } else {
          console.warn('Failed to fetch SVG, using mock');
          setSvgContent(createMockSVG());
        }
      }
      // If we have neither, use a mock SVG
      else {
        console.warn('No SVG source provided, using mock');
        setSvgContent(createMockSVG());
      }
    } catch (error) {
      console.error('Error loading SVG:', error);
      setSvgContent(createMockSVG());
    }
    setIsLoading(false);
  };

  const createMockSVG = () => {
    // Use consistent dimensions that match the expected SVG space
    const width = 3024;
    const height = 2160;
    
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="white" stroke="#ccc"/>
      <text x="50" y="50" font-size="24" font-weight="bold">STRUCTURAL ANALYSIS REPORT</text>
      <text x="50" y="120" font-size="18">Project ID: CONC-2024-001</text>
      <text x="50" y="160" font-size="18">Sheet ${sheetData?.index || 0}</text>
      <rect x="50" y="220" width="600" height="240" fill="none" stroke="#666" stroke-dasharray="5,5"/>
      <text x="60" y="250" font-size="20" font-weight="bold">LOAD ANALYSIS TABLE</text>
      <text x="50" y="550" font-size="18">MOMENT CALCULATION SECTION</text>
    </svg>`;
  };

  const loadBoundingBoxes = async () => {
    if (!sheetData) return;
    
    console.log('loadBoundingBoxes called for sheet:', sheetData.index);
    console.log('Current SVG dimensions:', svgDimensions);
    
    try {
      const sheetId = `page_${String(sheetData.index).padStart(3, '0')}`;
      console.log('Loading bounding boxes for sheetId:', sheetId);
      const data = await fetchBoundingBoxes(sheetId);
      
      console.log('Bounding boxes data received:', data);
      
      if (data && data.bounding_boxes) {
        const boxes = (data.bounding_boxes || []).map((box: any) => {
          console.log('Processing box from API:', {
            id: box.id,
            originalCoords: { x: box.x, y: box.y, width: box.width, height: box.height },
            chunkrDims: { pageWidth: box.pageWidth, pageHeight: box.pageHeight }
          });
          
          // Apply coordinate transformation from Chunkr to SVG space
          const transformedBox = transformChunkrToSvg(box, svgDimensions);
          
          return {
            ...transformedBox,
            // Ensure all required fields have default values for backward compatibility
            id: transformedBox.id || `box_${Date.now()}`,
            code: transformedBox.code || '',
            title: transformedBox.title || transformedBox.text || 'Untitled',
            content: transformedBox.content || '',
            type: transformedBox.type === 'title' || transformedBox.type === 'data' || transformedBox.type === 'number' 
              ? 'text' // Convert old types to 'text'
              : (transformedBox.type || 'figure'),
            shape: transformedBox.shape || 'rectangle', // Default shape for backward compatibility
            color: transformedBox.color || '#FF5722', // Default color
            // Ensure numeric coordinates (after transformation)
            x: Number(transformedBox.x) || 0,
            y: Number(transformedBox.y) || 0,
            width: Number(transformedBox.width) || 100,
            height: Number(transformedBox.height) || 100,
            // Store original reference dimensions for editing
            pageWidth: box.pageWidth || 3456,
            pageHeight: box.pageHeight || 2592,
            userModified: box.userModified || false
          };
        });
        console.log('Processed bounding boxes:', boxes.length, 'boxes');
        console.log('Sample transformed box:', boxes[0]);
        setBoundingBoxes(boxes);
      } else {
        console.log('No bounding boxes found');
        setBoundingBoxes([]);
      }
    } catch (error) {
      console.error('Error loading bounding boxes:', error);
      setBoundingBoxes([]);
    }
  };

  const loadSheetCodes = async () => {
    if (!sheetData) return;
    
    try {
      const sheetId = String(sheetData.index).padStart(3, '0');
      const response = await fetch(`http://localhost:8080/info_extract/info/analysis_page_${sheetId}.json`);
      
      if (response.ok) {
        const data = await response.json();
        
        // Extract sheet codes
        const codes = data.patterns
          ?.filter((pattern: any) => pattern.pattern_type === 'sheet_codes')
          ?.map((pattern: any) => ({
            index: pattern.index,
            text: pattern.text,
            coordinates: pattern.coordinates,
            shape_analysis: pattern.shape_analysis
          })) || [];
        
        // Extract SF patterns
        const sfPatterns = data.patterns
          ?.filter((pattern: any) => pattern.pattern_type === 'sf_patterns')
          ?.map((pattern: any) => ({
            index: pattern.index,
            text: pattern.text,
            coordinates: pattern.coordinates
          })) || [];
        
        // Extract CW patterns  
        const cwPatterns = data.patterns
          ?.filter((pattern: any) => pattern.pattern_type === 'cw_patterns')
          ?.map((pattern: any) => ({
            index: pattern.index,
            text: pattern.text,
            coordinates: pattern.coordinates
          })) || [];
        
        // Extract Integer patterns
        const integerPatterns = data.patterns
          ?.filter((pattern: any) => pattern.pattern_type === 'integers')
          ?.map((pattern: any) => ({
            index: pattern.index,
            text: pattern.text,
            coordinates: pattern.coordinates
          })) || [];
        
        setSheetCodes(codes);
        setSfPatterns(sfPatterns);
        setCwPatterns(cwPatterns);
        setIntegerPatterns(integerPatterns);
        
      } else {
        setSheetCodes([]);
        setSfPatterns([]);
        setCwPatterns([]);
        setIntegerPatterns([]);
      }
    } catch (error) {
      setSheetCodes([]);
      setSfPatterns([]);
      setCwPatterns([]);
      setIntegerPatterns([]);
    }
  };

  const loadSheetMappings = async () => {
    try {
      const response = await fetch('http://localhost:8080/sheet.json');
      if (response.ok) {
        const data = await response.json();
        setSheetMappings(data);
      }
    } catch (error) {
      console.error('Error loading sheet mappings:', error);
    }
  };

  const saveBoundingBoxes = async () => {
    if (!sheetData || isSaving || boundingBoxes.length === 0) return;
    
    setIsSaving(true);
    try {
      const sheetId = `page_${String(sheetData.index).padStart(3, '0')}`;
      
      // Validate bounding boxes before saving
      const validBoxes = boundingBoxes.filter(box => 
        box.id && 
        typeof box.x === 'number' && 
        typeof box.y === 'number' && 
        typeof box.width === 'number' && 
        typeof box.height === 'number' &&
        box.width > 0 && 
        box.height > 0
      );
      
      if (validBoxes.length !== boundingBoxes.length) {
        console.warn(`Filtered out ${boundingBoxes.length - validBoxes.length} invalid bounding boxes`);
      }
      
      // Back-transform coordinates to Chunkr space before saving
      const backTransformedBoxes = validBoxes.map(box => {
        if (box.pageWidth && box.pageHeight) {
          // Back-transform to original coordinate system
          const chunkrCoords = transformSvgToChunkr(box, box.pageWidth, box.pageHeight, svgDimensions);
          console.log('Saving box - back-transforming:', {
            boxId: box.id,
            svgCoords: { x: box.x, y: box.y, width: box.width, height: box.height },
            chunkrCoords: { x: chunkrCoords.x, y: chunkrCoords.y, width: chunkrCoords.width, height: chunkrCoords.height },
            dimensions: { pageWidth: box.pageWidth, pageHeight: box.pageHeight, svg: svgDimensions }
          });
          
          return {
            ...box,
            x: chunkrCoords.x,
            y: chunkrCoords.y,
            width: chunkrCoords.width,
            height: chunkrCoords.height
          };
        }
        console.log('Saving box without transformation (no Chunkr dimensions):', box.id);
        return box; // Keep as-is for boxes without page dimensions
      });
      
      const success = await saveBoundingBoxesToAPI(sheetId, backTransformedBoxes, svgDimensions);
      
      if (!success) {
        throw new Error('Failed to save bounding boxes');
      }
      
      console.log(`✅ Successfully saved ${backTransformedBoxes.length} bounding boxes for ${sheetId}`);
    } catch (error) {
      console.error('Error saving bounding boxes:', error);
      // Show error to user (you might want to add a toast notification here)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Failed to save bounding boxes: ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  };

  const addBoundingBox = useCallback(() => {
    // Calculate position based on current view
    const x = 100 / stage.scale - stage.x / stage.scale;
    const y = 100 / stage.scale - stage.y / stage.scale;
    
    // Create a new bounding box
    const newBox = createBoundingBox(x, y);
    
    setBoundingBoxes(prev => [...prev, newBox]);
    setSelectedBox(newBox.id);
  }, [stage.scale, stage.x, stage.y]);

  const deleteBoundingBox = useCallback((id: string) => {
    setBoundingBoxes(prev => prev.filter(box => box.id !== id));
    setSelectedBox(null);
  }, []);

  const updateBoundingBox = useCallback((id: string, updates: Partial<BoundingBox>) => {
    // Validate numeric updates
    const validatedUpdates: Partial<BoundingBox> = { ...updates };
    
    // Ensure numeric fields are actually numbers
    if (validatedUpdates.x !== undefined) validatedUpdates.x = Number(validatedUpdates.x) || 0;
    if (validatedUpdates.y !== undefined) validatedUpdates.y = Number(validatedUpdates.y) || 0;
    if (validatedUpdates.width !== undefined) validatedUpdates.width = Math.max(5, Number(validatedUpdates.width) || 100);
    if (validatedUpdates.height !== undefined) validatedUpdates.height = Math.max(5, Number(validatedUpdates.height) || 100);
    
    // Store original dimensions to detect significant changes
    const originalBox = boundingBoxes.find(box => box.id === id);
    
    // Apply updates to the bounding boxes
    setBoundingBoxes(prev => prev.map(box => 
      box.id === id ? { ...box, ...validatedUpdates } : box
    ));
    
    // Schedule a save after a short delay (for performance)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      if (sheetData && !isSaving) {
        saveBoundingBoxes();
      }
    }, 2000); // 2 second debounce
  }, [sheetData, isSaving, saveBoundingBoxes, boundingBoxes]);

  // Handler for individual box updates with coordinate transformation
  const handleBoxEdit = useCallback(async (boxId: string, newSvgCoords: Partial<BoundingBox>) => {
    const box = boundingBoxes.find(b => b.id === boxId);
    if (!box) {
      console.error('Box not found for edit:', boxId);
      return;
    }

    console.log('handleBoxEdit called:', {
      boxId,
      newSvgCoords,
      currentBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      chunkrDims: { pageWidth: box.pageWidth, pageHeight: box.pageHeight }
    });

    // Back-transform coordinates if position/size changed
    let updateData = { ...newSvgCoords };
    if (newSvgCoords.x !== undefined || newSvgCoords.y !== undefined || 
        newSvgCoords.width !== undefined || newSvgCoords.height !== undefined) {
      
      if (box.pageWidth && box.pageHeight) {
        const coordsToTransform = {
          x: newSvgCoords.x ?? box.x,
          y: newSvgCoords.y ?? box.y,
          width: newSvgCoords.width ?? box.width,
          height: newSvgCoords.height ?? box.height
        };
        
        const chunkrCoords = transformSvgToChunkr(coordsToTransform, box.pageWidth, box.pageHeight, svgDimensions);
        updateData = {
          ...updateData,
          x: chunkrCoords.x,
          y: chunkrCoords.y,
          width: chunkrCoords.width,
          height: chunkrCoords.height,
          userModified: true
        };
        
        console.log('Transformed coordinates for API update:', {
          svgCoords: coordsToTransform,
          chunkrCoords,
          updateData
        });
      } else {
        console.log('No Chunkr dimensions available, using SVG coordinates directly');
        updateData = { ...updateData, userModified: true };
      }
    }

    // Update via API
    const sheetId = `page_${String(sheetData?.index).padStart(3, '0')}`;
    const success = await updateBoundingBoxAPI(sheetId, boxId, updateData);

    if (success) {
      // Update local state with SVG coordinates (for display)
      setBoundingBoxes(boxes => 
        boxes.map(b => 
          b.id === boxId ? { ...b, ...newSvgCoords, userModified: true } : b
        )
      );
      console.log('✅ Box updated successfully:', boxId);
    } else {
      console.error('❌ Failed to update box:', boxId);
    }
  }, [boundingBoxes, transformSvgToChunkr, svgDimensions, sheetData?.index]);

  const handleBoxSelect = useCallback((id: string) => {
    setSelectedBox(id);
  }, []);

  const handleBoxDeselect = useCallback(() => {
    setSelectedBox(null);
  }, []);

  // Viewport culling - only render boxes that are visible
  const getCalculatedVisibleBounds = useCallback(() => {
    return getVisibleBounds(stage, stageSize);
  }, [stage.x, stage.y, stage.scale, stageSize.width, stageSize.height]);

  const visibleBoxes = useMemo(() => {
    const bounds = getCalculatedVisibleBounds();
    return getVisibleBoxes(boundingBoxes, bounds);
  }, [boundingBoxes, getCalculatedVisibleBounds]);

  // Throttle wheel events for better performance
  const lastWheelTime = useRef(0);
  const wheelRequestId = useRef<number | null>(null);

  const handleWheel = useCallback((e: any) => {
    // We don't call preventDefault() here to avoid passive listener warning
    // e.evt.preventDefault(); 
    
    const now = Date.now();
    if (now - lastWheelTime.current < 16) return; // Throttle to ~60fps
    lastWheelTime.current = now;

    if (wheelRequestId.current) {
      cancelAnimationFrame(wheelRequestId.current);
    }

    wheelRequestId.current = requestAnimationFrame(() => {
      const scaleBy = 1.1;
      const stage = e.target.getStage();
      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      
      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
      const clampedScale = Math.max(0.1, Math.min(5, newScale));

      setStage({
        scale: clampedScale,
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      });
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setStage(prev => ({
      ...prev,
      scale: Math.min(5, prev.scale * 1.2)
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setStage(prev => ({
      ...prev,
      scale: Math.max(0.1, prev.scale / 1.2)
    }));
  }, []);

  const handleReset = useCallback(() => {
    setStage({ scale: 0.5, x: 0, y: 0 });
  }, []);

  const handleFit = useCallback(() => {
    if (!svgImage || stageSize.width === 0 || stageSize.height === 0) return;
    
    const scaleX = stageSize.width / svgDimensions.width;
    const scaleY = stageSize.height / svgDimensions.height;
    const scale = Math.min(scaleX, scaleY) * 0.9;
    
    setStage({
      scale,
      x: (stageSize.width - svgDimensions.width * scale) / 2,
      y: (stageSize.height - svgDimensions.height * scale) / 2,
    });
  }, [svgImage, stageSize.width, stageSize.height, svgDimensions.width, svgDimensions.height]);

  // Optimized drag handlers
  const handleStageDragEnd = useCallback((e: any) => {
    setStage(prev => ({
      ...prev,
      x: e.target.x(),
      y: e.target.y()
    }));
  }, []);

  const handleStageClick = useCallback((e: any) => {
    // Check if we clicked on the stage itself (not on any shape)
    const clickedOnEmpty = e.target === e.target.getStage();
    // Also check if we clicked on the background SVG image
    const clickedOnBackground = e.target.getClassName() === 'Image';
    
    if (clickedOnEmpty || clickedOnBackground) {
      if (viewMode === 'select') {
        // In select mode, only clear the selection rectangle, keep selected patterns
        setSelectionStart(null);
        setSelectionEnd(null);
        setIsSelecting(false);
        // Don't clear selectedPatterns - let them persist
      } else {
        handleBoxDeselect();
      }
    }
  }, [handleBoxDeselect, viewMode]);

  // Find patterns within a selection rectangle
  const findPatternsInSelection = useCallback((startPoint: {x: number, y: number}, endPoint: {x: number, y: number}) => {
    const minX = Math.min(startPoint.x, endPoint.x);
    const maxX = Math.max(startPoint.x, endPoint.x);
    const minY = Math.min(startPoint.y, endPoint.y);
    const maxY = Math.max(startPoint.y, endPoint.y);

    const selectedSf: any[] = [];
    const selectedCw: any[] = [];
    const selectedInteger: any[] = [];
    const selectedSheet: any[] = [];

    // Check SF patterns
    sfPatterns.forEach(pattern => {
      const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
      if (coords.x >= minX && coords.x <= maxX && coords.y >= minY && coords.y <= maxY) {
        selectedSf.push(pattern);
      }
    });

    // Check CW patterns  
    cwPatterns.forEach(pattern => {
      const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
      if (coords.x >= minX && coords.x <= maxX && coords.y >= minY && coords.y <= maxY) {
        selectedCw.push(pattern);
      }
    });

    // Check integer patterns
    integerPatterns.forEach(pattern => {
      const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
      if (coords.x >= minX && coords.x <= maxX && coords.y >= minY && coords.y <= maxY) {
        selectedInteger.push(pattern);
      }
    });

    // Check sheet codes
    sheetCodes.forEach(pattern => {
      const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
      if (coords.x >= minX && coords.x <= maxX && coords.y >= minY && coords.y <= maxY) {
        selectedSheet.push(pattern);
      }
    });

    return { sf: selectedSf, cw: selectedCw, integer: selectedInteger, sheet: selectedSheet };
  }, [sfPatterns, cwPatterns, integerPatterns, sheetCodes, svgDimensions]);

  // Handle mouse down for area selection
  const handleStageMouseDown = useCallback((e: any) => {
    if (viewMode !== 'select') return;
    
    const clickedOnEmpty = e.target === e.target.getStage();
    const clickedOnBackground = e.target.getClassName() === 'Image';
    
    if (clickedOnEmpty || clickedOnBackground) {
      const pos = e.target.getStage().getPointerPosition();
      const stageAttrs = e.target.getStage().attrs;
      
      // Convert screen coordinates to stage coordinates
      const stageX = (pos.x - stageAttrs.x) / stageAttrs.scaleX;
      const stageY = (pos.y - stageAttrs.y) / stageAttrs.scaleY;
      
      setSelectionStart({x: stageX, y: stageY});
      setSelectionEnd({x: stageX, y: stageY});
      setIsSelecting(true);
      // Don't clear selectedPatterns here - let them accumulate
    }
  }, [viewMode]);

  // Handle mouse move for area selection
  const handleStageMouseMove = useCallback((e: any) => {
    if (viewMode !== 'select' || !isSelecting || !selectionStart) return;
    
    const pos = e.target.getStage().getPointerPosition();
    const stageAttrs = e.target.getStage().attrs;
    
    // Convert screen coordinates to stage coordinates
    const stageX = (pos.x - stageAttrs.x) / stageAttrs.scaleX;
    const stageY = (pos.y - stageAttrs.y) / stageAttrs.scaleY;
    
    setSelectionEnd({x: stageX, y: stageY});
  }, [viewMode, isSelecting, selectionStart]);

  // Handle mouse up for area selection
  const handleStageMouseUp = useCallback((e: any) => {
    if (viewMode !== 'select' || !isSelecting || !selectionStart || !selectionEnd) return;
    
    setIsSelecting(false);
    
    // Find patterns within the selection
    const newPatterns = findPatternsInSelection(selectionStart, selectionEnd);
    
    // Accumulate with existing patterns, avoiding duplicates
    setSelectedPatterns(prev => {
      const combinedSf = [...prev.sf];
      const combinedCw = [...prev.cw];
      const combinedInteger = [...prev.integer];
      const combinedSheet = [...prev.sheet];
      
      // Add new SF patterns if not already present
      newPatterns.sf.forEach(pattern => {
        if (!combinedSf.find(p => p.index === pattern.index)) {
          combinedSf.push(pattern);
        }
      });
      
      // Add new CW patterns if not already present
      newPatterns.cw.forEach(pattern => {
        if (!combinedCw.find(p => p.index === pattern.index)) {
          combinedCw.push(pattern);
        }
      });
      
      // Add new integer patterns if not already present
      newPatterns.integer.forEach(pattern => {
        if (!combinedInteger.find(p => p.index === pattern.index)) {
          combinedInteger.push(pattern);
        }
      });
      
      // Add new sheet patterns if not already present
      newPatterns.sheet.forEach(pattern => {
        if (!combinedSheet.find(p => p.index === pattern.index)) {
          combinedSheet.push(pattern);
        }
      });
      
      return {
        sf: combinedSf,
        cw: combinedCw,
        integer: combinedInteger,
        sheet: combinedSheet
      };
    });
  }, [viewMode, isSelecting, selectionStart, selectionEnd, findPatternsInSelection]);

  // Clear all selected patterns
  const clearSelectedPatterns = useCallback(() => {
    setSelectedPatterns({sf: [], cw: [], integer: [], sheet: []});
    setSelectionStart(null);
    setSelectionEnd(null);
    setIsSelecting(false);
  }, []);

  // Add a zoom window
  const addZoomWindow = useCallback((boundingBox: BoundingBox, clickPosition: {x: number, y: number}, sourcePattern?: any, parentId?: string) => {
    const parentWindow = parentId ? zoomWindows.find(w => w.id === parentId) : null;
    const level = parentWindow ? (parentWindow.level || 0) + 1 : 0;
    
    // Calculate position for nested windows - place to the right of parent
    let finalPosition = clickPosition;
    if (parentWindow) {
      const windowWidth = 1050; // Zoom window width
      const spacing = 20; // Space between windows
      const maxRight = window.innerWidth - windowWidth - spacing;
      
      let newX = parentWindow.position.x + windowWidth + spacing;
      let newY = parentWindow.position.y + (level * 30); // Slight vertical cascade
      
      // If the new window would go off-screen, stack it vertically instead
      if (newX > maxRight) {
        newX = parentWindow.position.x;
        newY = parentWindow.position.y + 1050 + spacing; // Below the parent
      }
      
      // Ensure it doesn't go below the screen
      if (newY > window.innerHeight - 1050) {
        newY = Math.max(0, window.innerHeight - 1050);
      }
      
      finalPosition = { x: newX, y: newY };
    }
    
    const newWindow: ZoomWindow = {
      id: `zoom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      boundingBox,
      position: finalPosition,
      sourcePattern, // Include the source pattern if provided
      parentId,
      level
    };
    
    setZoomWindows(prev => [...prev, newWindow]);
  }, [zoomWindows]);

  // Remove a zoom window and all its children
  const removeZoomWindow = useCallback((id: string) => {
    const findAllChildren = (windowId: string): string[] => {
      const children = zoomWindows
        .filter(w => w.parentId === windowId)
        .map(w => w.id);
      
      // Recursively find all descendants
      const allDescendants = children.flatMap(childId => [childId, ...findAllChildren(childId)]);
      return allDescendants;
    };
    
    const windowsToRemove = [id, ...findAllChildren(id)];
    setZoomWindows(prev => prev.filter(window => !windowsToRemove.includes(window.id)));
  }, [zoomWindows]);

  // Handle dragging of zoom windows
  const handleZoomWindowDrag = useCallback((id: string, newPosition: {x: number, y: number}) => {
    setZoomWindows(prev => prev.map(window => 
      window.id === id ? { ...window, position: newPosition } : window
    ));
  }, []);

  // Open zoom window for a selected pattern
  const openPatternZoomWindow = useCallback((pattern: any, type: 'sf' | 'cw' | 'sheet' | 'integer') => {
    // Convert pattern coordinates
    const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
    
    // Create a bounding box for zooming
    const patternBox: BoundingBox = {
      id: `selected-pattern-${type}-${pattern.text}-${Date.now()}`,
      x: coords.x,
      y: coords.y,
      width: coords.width || 50,
      height: coords.height || 20,
      code: pattern.text,
      title: `${type.toUpperCase()} Pattern: ${pattern.text}`,
      content: '',
      type: 'figure',
      shape: 'circle',
      color: type === 'sf' ? '#3B82F6' : type === 'cw' ? '#10B981' : type === 'integer' ? '#9333ea' : '#F59E0B'
    };
    
    // Create a pattern object with type information
    const patternWithType = {
      ...pattern,
      patternType: type
    };
    
    // Calculate position for the zoom window (center of screen with some offset)
    const windowPosition = {
      x: Math.max(100, (window.innerWidth / 2) - 525 + (zoomWindows.length * 50)), // Offset multiple windows
      y: Math.max(100, (window.innerHeight / 2) - 525 + (zoomWindows.length * 30))
    };
    
    // Add the zoom window for this pattern
    addZoomWindow(patternBox, windowPosition, patternWithType);
  }, [transformPatternCoordinates, svgDimensions, addZoomWindow, zoomWindows.length]);

  // Check if a pattern button is within a bounding box
  // Use the imported isPatternWithinBox function with the transformPatternCoordinates
  const isPatternWithinBoundingBox = useCallback((patternCoords: any, boundingBox: BoundingBox) => {
    return isPatternWithinBox(patternCoords, boundingBox, 
      (coords) => transformPatternCoordinates(coords, svgDimensions));
  }, [svgDimensions]);

  // Auto-scan after loading everything
  useEffect(() => {
    // Only run if we have SVG image, bounding boxes, and patterns
    if (svgImage && 
        (sheetCodes.length > 0 || sfPatterns.length > 0 || cwPatterns.length > 0 || integerPatterns.length > 0)) {
      
      // Also scan with no bounding box to ensure all patterns are visible
      const allPatterns = new Set<string>();
      
      // Wait a moment to ensure all data is loaded and rendered
      setTimeout(() => {
        // First, collect all patterns regardless of bounding boxes
        sheetCodes.forEach(pattern => {
          allPatterns.add(`sheet-code-${pattern.index}-${pattern.text}`);
        });
        
        sfPatterns.forEach(pattern => {
          allPatterns.add(`sf-pattern-${pattern.index}-${pattern.text}`);
        });
        
        cwPatterns.forEach(pattern => {
          allPatterns.add(`cw-pattern-${pattern.index}-${pattern.text}`);
        });
        
        integerPatterns.forEach(pattern => {
          allPatterns.add(`integer-pattern-${pattern.index}-${pattern.text}`);
        });
        
      }, 1000);
    }
  }, [svgImage, boundingBoxes, sheetCodes, sfPatterns, cwPatterns, integerPatterns, viewMode]);

  // Auto-fit when SVG loads and container is ready, or zoom to target bounding box
  useEffect(() => {
    if (svgImage && stageSize.width > 0 && stageSize.height > 0) {
      if (targetBoundingBox && !hasUsedTargetBoundingBox) {
        
        // Zoom to the target bounding box
        const padding = 50; // Extra padding around the bounding box
        const boxWithPadding = {
          x: targetBoundingBox.x - padding,
          y: targetBoundingBox.y - padding,
          width: targetBoundingBox.width + (padding * 2),
          height: targetBoundingBox.height + (padding * 2)
        };
        
        // Calculate scale to fit the bounding box in the view
        const scaleX = stageSize.width / boxWithPadding.width;
        const scaleY = stageSize.height / boxWithPadding.height;
        const scale = Math.min(scaleX, scaleY, 2); // Max zoom of 2x
        
        // Calculate position to center the bounding box
        const x = (stageSize.width - boxWithPadding.width * scale) / 2 - (boxWithPadding.x * scale);
        const y = (stageSize.height - boxWithPadding.height * scale) / 2 - (boxWithPadding.y * scale);
        
        setStage({ scale, x, y });
        
        // Select the target bounding box if it exists in current sheet
        const targetBox = boundingBoxes.find(box => 
          box.code && targetBoundingBox.code && 
          box.code.toLowerCase() === targetBoundingBox.code.toLowerCase()
        );
        if (targetBox) {
          setSelectedBox(targetBox.id);
        } else {
        }
        
        setHasUsedTargetBoundingBox(true); // Mark as used
      } else if (!targetBoundingBox && !hasUsedTargetBoundingBox) {
        // Normal auto-fit behavior only if we haven't used a target bounding box
        handleFit();
      } else if (!targetBoundingBox && hasUsedTargetBoundingBox) {
        // Don't auto-fit again, maintain the zoom we set
      }
    }
  }, [svgImage, stageSize, targetBoundingBox, boundingBoxes, handleFit, hasUsedTargetBoundingBox]);

  // Reset the flag when the component key changes (new sheet)
  useEffect(() => {
    setHasUsedTargetBoundingBox(false);
  }, [sheetData?.index]);

  // Report zoom config changes to parent
  useEffect(() => {
    if (onZoomConfigChange && stage.scale !== 0.5) { // Only report if not default
      onZoomConfigChange(stage);
    }
  }, [stage, onZoomConfigChange]);

  // Restore zoom config when provided
  useEffect(() => {
    if (restoreZoomConfig && svgImage && stageSize.width > 0 && stageSize.height > 0) {
      setStage(restoreZoomConfig);
      setHasUsedTargetBoundingBox(true); // Mark as used to prevent auto-fit
    }
  }, [restoreZoomConfig, svgImage, stageSize]);

  const handleClose = async () => {
    // Clear transformer before closing
    if (transformerRef.current) {
      transformerRef.current.nodes([]);
    }
    
    // Save bounding boxes before closing if in edit mode
    if (sheetData && boundingBoxes.length > 0 && !isSaving) {
      try {
        const sheetId = `page_${String(sheetData.index).padStart(3, '0')}`;
        await saveBoundingBoxesToAPI(sheetId, boundingBoxes, svgDimensions);
      } catch (error) {
        console.error('Failed to save bounding boxes on close:', error);
      }
    }
    
    setSvgContent('');
    setSvgImage(null);
    setStage({ scale: 0.5, x: 0, y: 0 });
    setBoundingBoxes([]);
    setSelectedBox(null);
    setSheetCodes([]);
    setSfPatterns([]);
    setCwPatterns([]);
    setIntegerPatterns([]);
    setSheetMappings([]);
    onClose();
  };

  // Clear transformer when bounding boxes change drastically
  useEffect(() => {
    if (transformerRef.current && selectedBox) {
      const selectedExists = boundingBoxes.find(box => box.id === selectedBox);
      if (!selectedExists) {
        transformerRef.current.nodes([]);
        setSelectedBox(null);
      }
    }
  }, [boundingBoxes.length, selectedBox]);

  // Update transformer when selection changes
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;

    const transformer = transformerRef.current;
    
    // Clear transformer first
    transformer.nodes([]);
    
    if (selectedBox) {
      // Wait for next tick to ensure DOM is updated
      requestAnimationFrame(() => {
        const selectedNode = stageRef.current?.findOne(`#${selectedBox}`);
        
        if (selectedNode && 
            typeof selectedNode.getAbsoluteTransform === 'function' &&
            selectedNode.getStage && 
            selectedNode.getStage() === stageRef.current) { // Ensure node is still attached to our stage
          
          try {
            transformer.nodes([selectedNode]);
            transformer.getLayer()?.batchDraw();
          } catch (error) {
            console.warn('Error setting transformer nodes:', error);
            transformer.nodes([]);
          }
        }
      });
    } else {
      // Immediately update if no selection
      transformer.getLayer()?.batchDraw();
    }
  }, [selectedBox]);

  const selectedBoxData = selectedBox ? boundingBoxes.find(box => box.id === selectedBox) : null;

  // Immediate input updates for better UX (no debouncing for now to avoid conflicts)
  const handleInputUpdate = useCallback((id: string, updates: Partial<BoundingBox>) => {
    updateBoundingBox(id, updates);
  }, [updateBoundingBox]);

  // Create handlers for a bounding box
  // Use the imported createBoxHandlers directly
  const createComponentBoxHandlers = useCallback((boxId: string) => {
    // Basic handlers from the utility
    const basicHandlers = createBoxHandlers(boxId, handleBoxSelect, updateBoundingBox);
    
    // Add additional handlers or modify existing ones
    return {
      ...basicHandlers,
      
      // Add a custom transform handler to handle stage scaling
      onTransformEnd: (e: any) => {
        // Get the node being transformed
        const node = e.target;
        
        // Store the current position and dimensions before any changes
        const currentX = node.x();
        const currentY = node.y();
        const currentWidth = node.width();
        const currentHeight = node.height();
        
        // Get the scale values applied by the transformer
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        
        // Calculate the actual width and height after transformation
        const newWidth = Math.max(5, currentWidth * scaleX);
        const newHeight = Math.max(5, currentHeight * scaleY);
        
        // Reset scale to avoid cumulative scaling issues
        node.scaleX(1);
        node.scaleY(1);
        
        // Set the explicit width and height on the node
        node.width(newWidth);
        node.height(newHeight);
        
        // Update the box in the state with new dimensions
        updateBoundingBox(boxId, {
          x: currentX,
          y: currentY,
          width: newWidth,
          height: newHeight
        });
      }
    };
  }, [handleBoxSelect, updateBoundingBox]);

  // Create handlers for pattern buttons
  const createPatternHandlers = useCallback((pattern: any, type: 'sf' | 'cw' | 'sheet' | 'integer') => {
    return {
      onClick: (e: any) => {
        const stage = e.target.getStage();
        const pointerPos = stage.getPointerPosition();
        
        // Get the position in absolute coordinates
        const absPosition = {
          x: pointerPos.x,
          y: pointerPos.y
        };
        
        // Convert pattern coordinates
        const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
        
        // Create a bounding box for zooming
        const patternBox: BoundingBox = {
          id: `pattern-${type}-${pattern.text}-${Date.now()}`,
          x: coords.x,
          y: coords.y,
          width: coords.width || 50,
          height: coords.height || 20,
          code: pattern.text,
          title: `${type.toUpperCase()} Pattern: ${pattern.text}`,
          content: '',
          type: 'figure',
          shape: 'circle',
          color: type === 'sf' ? '#3B82F6' : type === 'cw' ? '#10B981' : type === 'integer' ? '#9333ea' : '#F59E0B'
        };
        
        // Create a pattern object with type information
        const patternWithType = {
          ...pattern,
          patternType: type
        };
        
        // Add the zoom window for this pattern, passing the pattern data
        addZoomWindow(patternBox, absPosition, patternWithType);
        e.cancelBubble = true;
      }
    };
  }, [addZoomWindow, transformPatternCoordinates]);

  // Handle view mode change
  const handleViewModeChange = useCallback((newMode: ViewMode) => {
    // If switching from edit mode to patterns mode, save the bounding boxes first
    if (viewMode === 'edit' && newMode === 'patterns') {
      saveBoundingBoxes();
    }
    
    // If switching away from select mode, clear selections
    if (viewMode === 'select' && newMode !== 'select') {
      clearSelectedPatterns();
    }
    
    setViewMode(newMode);
  }, [viewMode, saveBoundingBoxes, clearSelectedPatterns]);

  // Import the render component
  const { PDFSVGEditorRender } = require('./pdf-svg-editor-render');

  // Auto-save bounding boxes periodically when in edit mode
  useEffect(() => {
    if (!isOpen || !sheetData || viewMode !== 'edit' || boundingBoxes.length === 0) return;
    
    const autoSaveInterval = setInterval(() => {
      if (!isSaving) {
        const sheetId = `page_${String(sheetData.index).padStart(3, '0')}`;
        saveBoundingBoxesToAPI(sheetId, boundingBoxes, svgDimensions)
          .then(success => {
            if (success) {
            }
          })
          .catch(error => {
            console.error('Auto-save failed:', error);
          });
      }
    }, 30000); // Auto-save every 30 seconds
    
    return () => clearInterval(autoSaveInterval);
  }, [isOpen, sheetData, viewMode, boundingBoxes, isSaving, svgDimensions]);

  // Handle pattern clicks from within zoom windows (nested zoom)
  const handleNestedPatternClick = useCallback((pattern: any, type: string, parentWindowId: string) => {
    console.log('Nested pattern click:', pattern, type, 'from window:', parentWindowId);
    console.log('Pattern structure:', JSON.stringify(pattern, null, 2));
    
    if (transformPatternCoordinates) {
      // Check what coordinates we have - prefer original coordinates for retransform
      const coords = pattern.originalCoordinates || pattern.coordinates || pattern.coords || pattern;
      console.log('Using coordinates:', coords);
      
      // Ensure coords is an array or properly structured
      if (!coords || (!Array.isArray(coords) && typeof coords !== 'object')) {
        console.error('Invalid coordinates for pattern:', pattern);
        return;
      }
      
      try {
        // Transform the pattern coordinates based on the current coordinate system
        const transformedPattern = transformPatternCoordinates(coords, svgDimensions);
        console.log('Transformed pattern:', transformedPattern);
        
        // Create a bounding box for the pattern with some padding
        const patternBox: BoundingBox = {
          id: `pattern-${type}-${pattern.id || Date.now()}`,
          x: transformedPattern.x - 100, // Add padding
          y: transformedPattern.y - 100,
          width: 200,
          height: 200,
          code: pattern.code || '',
          title: pattern.title || `${type} Pattern`,
          content: pattern.content || '',
          type: 'figure' as const,
          shape: 'circle' as const,
          color: '#ff0000'
        };
        
        // Create pattern with type info
        const patternWithType = {
          ...pattern,
          type: type,
          coordinates: transformedPattern
        };
        
        // Add a new zoom window as a child of the current one
        addZoomWindow(patternBox, { x: 0, y: 0 }, patternWithType, parentWindowId);
      } catch (error) {
        console.error('Error transforming pattern coordinates:', error);
        console.error('Pattern:', pattern);
        console.error('Coordinates:', coords);
      }
    }
  }, [addZoomWindow, transformPatternCoordinates, svgDimensions]);

  return (
    <PDFSVGEditorRender 
      isOpen={isOpen}
      handleClose={handleClose}
      sheetData={sheetData}
      navigationStack={navigationStack || []}
      onNavigateToBreadcrumb={onNavigateToBreadcrumb}
      isLoading={isLoading}
      svgContent={svgContent}
      containerRef={containerRef}
      zoomWindows={zoomWindows}
      ZoomWindowComponent={ZoomWindowComponent}
      addBoundingBox={addBoundingBox}
      saveBoundingBoxes={saveBoundingBoxes}
      isSaving={isSaving}
      handleZoomIn={handleZoomIn}
      handleZoomOut={handleZoomOut}
      handleReset={handleReset}
      handleFit={handleFit}
      stageSize={stageSize}
      stageRef={stageRef}
      stage={stage}
      handleWheel={handleWheel}
      handleStageDragEnd={handleStageDragEnd}
      handleStageClick={handleStageClick}
      svgImage={svgImage}
      svgDimensions={svgDimensions}
      visibleBoxes={visibleBoxes}
      selectedBox={selectedBox}
      createBoxHandlers={createComponentBoxHandlers}
      onNavigateToSheet={onNavigateToSheet}
      sheetCodes={sheetCodes}
      transformPatternCoordinates={transformPatternCoordinates}
      sheetMappings={sheetMappings}
      createPatternHandlers={createPatternHandlers}
      sfPatterns={sfPatterns}
      cwPatterns={cwPatterns}
      integerPatterns={integerPatterns}
      transformerRef={transformerRef}
      boundingBoxes={boundingBoxes}
      selectedBoxData={selectedBoxData}
      handleInputUpdate={handleInputUpdate}
      deleteBoundingBox={deleteBoundingBox}
      handleBoxSelect={handleBoxSelect}
      handleZoomWindowDrag={handleZoomWindowDrag}
      removeZoomWindow={removeZoomWindow}
      viewMode={viewMode}
      onViewModeChange={handleViewModeChange}
      handlePatternClick={handlePatternClick}
      isPatternWithinBoundingBox={isPatternWithinBoundingBox}
      handleNestedPatternClick={handleNestedPatternClick}
      // Area selection props
      handleStageMouseDown={handleStageMouseDown}
      handleStageMouseMove={handleStageMouseMove}
      handleStageMouseUp={handleStageMouseUp}
      isSelecting={isSelecting}
      selectionStart={selectionStart}
      selectionEnd={selectionEnd}
      selectedPatterns={selectedPatterns}
      clearSelectedPatterns={clearSelectedPatterns}
      openPatternZoomWindow={openPatternZoomWindow}
    />
  );
}

export default PDFSVGEditor;