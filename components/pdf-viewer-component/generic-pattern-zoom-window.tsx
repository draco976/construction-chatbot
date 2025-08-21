'use client';

import React, { useState, useEffect } from 'react';
import { ZoomWindowIframe } from './zoom-window-iframe';
import { BoundingBox } from '@/lib/bounding-box';
import { searchBoundingBoxAcrossSheets, getSheetSvgContent } from '@/lib/bounding-box/api';

interface GenericPatternZoomWindowProps {
  svgContent: string | null;
  svgDimensions: { width: number; height: number };
  boundingBox: BoundingBox;
  sfPatterns?: any[];
  cwPatterns?: any[];
  integerPatterns?: any[]; // Added integerPatterns
  transformPatternCoordinates?: (coords: any, svgDimensions?: { width: number; height: number }) => any;
  isPatternWithinBoundingBox?: (patternCoords: any, boundingBox: BoundingBox, transformFn: any) => boolean;
  onPatternClick?: (pattern: any, type: string) => void;
  mainViewerZoomScale?: number;
  mainViewerZoomEnabled?: boolean;
  // New props for single instance mode
  patternCode?: string; // The specific pattern code to search for (e.g., "SF 1", "CW 2", "A-1.1")
  patternType?: 'sf' | 'cw' | 'sheet'; // The type of pattern
}

/**
 * Specialized zoom window for generic patterns (SF, CW, etc.)
 * When patternCode and patternType are provided, it will search across all sheets
 * to find the specific pattern instance and zoom into that location
 */
export const GenericPatternZoomWindow: React.FC<GenericPatternZoomWindowProps> = ({
  svgContent,
  svgDimensions,
  boundingBox,
  sfPatterns = [],
  cwPatterns = [],
  integerPatterns = [], // Added integerPatterns with default empty array
  transformPatternCoordinates,
  isPatternWithinBoundingBox,
  onPatternClick,
  mainViewerZoomScale = 1,
  mainViewerZoomEnabled = true,
  patternCode,
  patternType
}) => {
  // State for single instance mode
  const [currentSvgContent, setCurrentSvgContent] = useState<string | null>(svgContent);
  const [currentSvgDimensions, setCurrentSvgDimensions] = useState(svgDimensions);
  const [adjustedBoundingBox, setAdjustedBoundingBox] = useState<BoundingBox>(boundingBox);
  const [isLoadingSvg, setIsLoadingSvg] = useState(false);
  const [foundInstance, setFoundInstance] = useState<{ box: BoundingBox, sheetIndex: number } | null>(null);

  // Effect to search for specific pattern instance
  useEffect(() => {
    const searchForPattern = async () => {
      if (!patternCode || !patternType) {
        // If no specific pattern to search for, use original behavior
        setCurrentSvgContent(svgContent);
        setCurrentSvgDimensions(svgDimensions);
        setAdjustedBoundingBox(boundingBox);
        return;
      }

      try {
        setIsLoadingSvg(true);
        let result = null;
        
        if (patternType === 'sf' || patternType === 'cw') {
          // For SF and CW patterns, format the pattern code and search in bounding boxes
          const formattedCode = formatPatternCode(patternCode, patternType);
          console.log(`Searching for ${patternType.toUpperCase()} pattern with code: ${formattedCode}`);
          result = await searchBoundingBoxAcrossSheets(formattedCode);
        } else if (patternType === 'sheet') {
          // For sheet codes, directly parse and open the sheet
          console.log(`Opening sheet for code: ${patternCode}`);
          const sheetIndex = await parseSheetCode(patternCode);
          if (sheetIndex !== null) {
            // Create a mock result to directly open the sheet
            result = {
              box: {
                id: `sheet-${patternCode}`,
                x: 0,
                y: 0,
                width: svgDimensions.width,
                height: svgDimensions.height,
                title: `Sheet ${patternCode}`,
                code: patternCode,
                content: '',
                type: 'figure' as const,
                shape: 'rectangle' as const,
                color: '#3b82f6'
              },
              sheetIndex: sheetIndex
            };
          } else {
            console.warn(`Could not parse sheet index from code: ${patternCode}`);
          }
        } else {
          // For other patterns, use the original search
          console.log(`Searching for pattern: ${patternCode}`);
          result = await searchBoundingBoxAcrossSheets(patternCode);
        }
        
        if (result) {
          setFoundInstance(result);
          const sheetId = `page_${String(result.sheetIndex).padStart(3, '0')}`;
          
          // Load the SVG content for the found sheet
          const { content, dimensions } = await getSheetSvgContent(sheetId);
          
          if (content) {
            setCurrentSvgContent(content);
            setCurrentSvgDimensions(dimensions);
            
            // Use the found bounding box coordinates
            setAdjustedBoundingBox(result.box);
          } else {
            // Fallback to original if SVG loading fails
            setCurrentSvgContent(svgContent);
            setCurrentSvgDimensions(svgDimensions);
            setAdjustedBoundingBox(boundingBox);
          }
        } else {
          // Pattern not found, use original content
          setCurrentSvgContent(svgContent);
          setCurrentSvgDimensions(svgDimensions);
          setAdjustedBoundingBox(boundingBox);
        }
      } catch (error) {
        console.error('Error searching for pattern:', error);
        // Fallback to original content on error
        setCurrentSvgContent(svgContent);
        setCurrentSvgDimensions(svgDimensions);
        setAdjustedBoundingBox(boundingBox);
      } finally {
        setIsLoadingSvg(false);
      }
    };

    searchForPattern();
  }, [patternCode, patternType, svgContent, svgDimensions, boundingBox]);

  // Helper function to parse sheet code and extract sheet index
  const parseSheetCode = async (code: string): Promise<number | null> => {
    const cleanCode = code.trim().toUpperCase();
    
    try {
      // Fetch the sheet mapping from sheet.json
      const response = await fetch('/sheet.json');
      if (!response.ok) {
        console.error('Failed to fetch sheet.json');
        return null;
      }
      
      const sheets: Array<{index: number, code: string, name: string, section: string}> = await response.json();
      
      // Find the sheet with matching code
      const matchingSheet = sheets.find(sheet => sheet.code.toUpperCase() === cleanCode);
      
      if (matchingSheet) {
        console.log(`Found sheet: ${cleanCode} -> index ${matchingSheet.index} (${matchingSheet.name})`);
        return matchingSheet.index;
      } else {
        console.warn(`Sheet code not found in sheet.json: ${cleanCode}`);
        // List available sheet codes for debugging
        console.log('Available sheet codes:', sheets.slice(0, 10).map(s => s.code).join(', '), '...');
        return null;
      }
    } catch (error) {
      console.error('Error fetching or parsing sheet.json:', error);
      return null;
    }
  };

  // Helper function to format pattern code for bounding box search
  const formatPatternCode = (code: string, type: 'sf' | 'cw') => {
    // For SF and CW patterns, the code from pattern.text is already in the correct format
    // Examples: "SF1" -> "SF1", "CW1A" -> "CW1A"
    const cleanCode = code.trim().toUpperCase();
    
    // If it already starts with SF or CW, return as is
    if (cleanCode.startsWith('SF') || cleanCode.startsWith('CW')) {
      return cleanCode;
    }
    
    // Otherwise, prepend the type (this handles cases like "1" -> "SF1")
    return `${type.toUpperCase()}${cleanCode}`;
  };

  // If in single instance mode, don't show all patterns, just focus on the found instance
  if (patternCode && patternType) {
    return (
      <div className="flex h-full">
        <div className="flex-1 relative">
          {isLoadingSvg ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-gray-500">
                Searching for {patternType.toUpperCase()} pattern "{patternCode}"...
              </div>
            </div>
          ) : !foundInstance ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-gray-500">
                Pattern "{patternCode}" not found in any sheet
              </div>
            </div>
          ) : (
            <ZoomWindowIframe
              svgContent={currentSvgContent}
              svgDimensions={currentSvgDimensions}
              boundingBox={adjustedBoundingBox}
              patternButtons="" // No pattern buttons in single instance mode
              onPatternClick={onPatternClick}
              sfPatterns={[]}
              cwPatterns={[]}
              integerPatterns={[]}
              transformPatternCoordinates={transformPatternCoordinates}
              isPatternWithinBoundingBox={isPatternWithinBoundingBox}
              sheetId={foundInstance ? `page_${String(foundInstance.sheetIndex).padStart(3, '0')}` : undefined}
            />
          )}
        </div>
      </div>
    );
  }
  // Original multi-pattern behavior when not in single instance mode
  // Filter SF patterns that are within the current bounding box
  const visibleSfPatterns = React.useMemo(() => {
    if (!sfPatterns || !transformPatternCoordinates || !isPatternWithinBoundingBox) return [];
    
    return sfPatterns.filter(pattern => 
      isPatternWithinBoundingBox(
        pattern.coordinates, 
        boundingBox,
        transformPatternCoordinates
      )
    );
  }, [sfPatterns, boundingBox, transformPatternCoordinates, isPatternWithinBoundingBox]);

  // Filter CW patterns that are within the current bounding box
  const visibleCwPatterns = React.useMemo(() => {
    if (!cwPatterns || !transformPatternCoordinates || !isPatternWithinBoundingBox) return [];
    
    return cwPatterns.filter(pattern => 
      isPatternWithinBoundingBox(
        pattern.coordinates, 
        boundingBox,
        transformPatternCoordinates
      )
    );
  }, [cwPatterns, boundingBox, transformPatternCoordinates, isPatternWithinBoundingBox]);

  // Filter Integer patterns that are within the current bounding box
  const visibleIntegerPatterns = React.useMemo(() => {
    if (!integerPatterns || !transformPatternCoordinates || !isPatternWithinBoundingBox) return [];
    
    return integerPatterns.filter(pattern => 
      isPatternWithinBoundingBox(
        pattern.coordinates, 
        boundingBox,
        transformPatternCoordinates
      )
    );
  }, [integerPatterns, boundingBox, transformPatternCoordinates, isPatternWithinBoundingBox]);

  // Generate SF pattern buttons script
  const sfPatternButtonsScript = React.useMemo(() => {
    if (!visibleSfPatterns.length) return '';
    
    return visibleSfPatterns.map(pattern => {
      const coords = transformPatternCoordinates 
        ? transformPatternCoordinates(pattern.coordinates, svgDimensions) 
        : { x: 0, y: 0 };
      
      // Extract sheet code from pattern text if available
      let extractedSheetCode = '';
      if (pattern.text) {
        const sheetCodeMatch = pattern.text.match(/[A-Z]-\d+\.?\d*|[A-Z]\d+\.\d+/);
        if (sheetCodeMatch && sheetCodeMatch.length > 0) {
          extractedSheetCode = sheetCodeMatch[0];
        }
      }
      
      // Enhance pattern data with potential sheet code
      const enhancedPattern = {
        ...pattern,
        extractedSheetCode
      };
      
      return `
        createPatternButton(
          'sf-${pattern.index}-${pattern.text || "sf-pattern"}', 
          ${coords.x}, 
          ${coords.y}, 
          'sf', 
          '${pattern.text || "SF Pattern"}', 
          ${JSON.stringify(enhancedPattern).replace(/"/g, '\\"')}
        );
      `;
    }).join('');
  }, [visibleSfPatterns, transformPatternCoordinates, svgDimensions]);

  // Generate CW pattern buttons script
  const cwPatternButtonsScript = React.useMemo(() => {
    if (!visibleCwPatterns.length) return '';
    
    return visibleCwPatterns.map(pattern => {
      const coords = transformPatternCoordinates 
        ? transformPatternCoordinates(pattern.coordinates, svgDimensions) 
        : { x: 0, y: 0 };
      
      // Extract sheet code from pattern text if available
      let extractedSheetCode = '';
      if (pattern.text) {
        const sheetCodeMatch = pattern.text.match(/[A-Z]-\d+\.?\d*|[A-Z]\d+\.\d+/);
        if (sheetCodeMatch && sheetCodeMatch.length > 0) {
          extractedSheetCode = sheetCodeMatch[0];
        }
      }
      
      // Enhance pattern data with potential sheet code
      const enhancedPattern = {
        ...pattern,
        extractedSheetCode
      };
      
      return `
        createPatternButton(
          'cw-${pattern.index}-${pattern.text || "cw-pattern"}', 
          ${coords.x}, 
          ${coords.y}, 
          'cw', 
          '${pattern.text || "CW Pattern"}', 
          ${JSON.stringify(enhancedPattern).replace(/"/g, '\\"')}
        );
      `;
    }).join('');
  }, [visibleCwPatterns, transformPatternCoordinates, svgDimensions]);

  // Generate Integer pattern buttons script
  const integerPatternButtonsScript = React.useMemo(() => {
    if (!visibleIntegerPatterns.length) return '';
    
    return visibleIntegerPatterns.map(pattern => {
      const coords = transformPatternCoordinates 
        ? transformPatternCoordinates(pattern.coordinates, svgDimensions) 
        : { x: 0, y: 0 };
      
      // Extract sheet code from pattern text if available
      let extractedSheetCode = '';
      if (pattern.text) {
        const sheetCodeMatch = pattern.text.match(/[A-Z]-\d+\.?\d*|[A-Z]\d+\.\d+/);
        if (sheetCodeMatch && sheetCodeMatch.length > 0) {
          extractedSheetCode = sheetCodeMatch[0];
        }
      }
      
      // Escape text for JavaScript string literals
      const safeText = (pattern.text || 'integer-pattern').replace(/['\\]/g, '\\$&');
      
      return `
        createPatternButton(
          'int-${pattern.index}', 
          ${coords.x}, 
          ${coords.y}, 
          'integer', 
          '${safeText}', 
          {
            index: ${pattern.index || 0},
            text: '${safeText}',
            coordinates: [${pattern.coordinates ? pattern.coordinates.join(',') : ''}],
            extractedSheetCode: '${extractedSheetCode.replace(/['\\]/g, '\\$&')}',
            patternType: 'integer'
          }
        );
      `;
    }).join('');
  }, [visibleIntegerPatterns, transformPatternCoordinates, svgDimensions]);

  // Combine all pattern button scripts
  const allPatternsScript = `${sfPatternButtonsScript}\n${cwPatternButtonsScript}\n${integerPatternButtonsScript}`;

  return (
    <ZoomWindowIframe
      svgContent={currentSvgContent}
      svgDimensions={currentSvgDimensions}
      boundingBox={adjustedBoundingBox}
      patternButtons={allPatternsScript}
      onPatternClick={onPatternClick}
      sfPatterns={sfPatterns}
      cwPatterns={cwPatterns}
      integerPatterns={integerPatterns}
      transformPatternCoordinates={transformPatternCoordinates}
      isPatternWithinBoundingBox={isPatternWithinBoundingBox}
    />
  );
};
