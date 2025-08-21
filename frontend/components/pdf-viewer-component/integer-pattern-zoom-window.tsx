'use client';

import React, { useState } from 'react';
import { ZoomWindowIframe } from './zoom-window-iframe';
import { BoundingBox, IntegerPatternSearchResult } from '@/lib/bounding-box';
import { getSheetSvgContent } from '@/lib/bounding-box/api';

interface IntegerPatternZoomWindowProps {
  svgContent: string | null;
  svgDimensions: { width: number; height: number };
  boundingBox: BoundingBox;
  integerPatterns?: any[];
  patternSearchResults?: IntegerPatternSearchResult[];
  transformPatternCoordinates?: (coords: any, svgDimensions?: { width: number; height: number }) => any;
  isPatternWithinBoundingBox?: (patternCoords: any, boundingBox: BoundingBox, transformFn: any) => boolean;
  onPatternClick?: (pattern: any, type: string) => void;
  getSvgForSheet?: (sheetId: string) => Promise<{
    content: string | null;
    dimensions: { width: number; height: number };
  }>;
  mainViewerZoomScale?: number;
  mainViewerZoomEnabled?: boolean;
}

/**
 * Specialized zoom window for integer patterns
 */
export const IntegerPatternZoomWindow: React.FC<IntegerPatternZoomWindowProps> = ({
  svgContent,
  svgDimensions,
  boundingBox,
  integerPatterns = [],
  patternSearchResults = [],
  transformPatternCoordinates,
  isPatternWithinBoundingBox,
  onPatternClick,
  getSvgForSheet = getSheetSvgContent, // Use the imported function as default
  mainViewerZoomScale = 1,
  mainViewerZoomEnabled = true
}) => {
  // State to track the selected pattern instance
  const [selectedInstance, setSelectedInstance] = React.useState<IntegerPatternSearchResult | null>(null);
  
  // State for current SVG content and dimensions
  const [currentSvgContent, setCurrentSvgContent] = React.useState<string | null>(svgContent);
  const [currentSvgDimensions, setCurrentSvgDimensions] = useState({width: 3024, height: 2160});
  const [isLoadingSvg, setIsLoadingSvg] = React.useState(false);
  
  // State for full pattern data with descriptions
  const [fullPatternData, setFullPatternData] = React.useState<Map<string, any>>(new Map());
  const [isLoadingPatternData, setIsLoadingPatternData] = React.useState(false);
  
  // Select the first pattern instance by default
  React.useEffect(() => {
    if (patternSearchResults.length > 0 && !selectedInstance) {
      setSelectedInstance(patternSearchResults[0]);
    }
  }, [patternSearchResults, selectedInstance]);
  
  // Load SVG content when selected instance changes
  React.useEffect(() => {
    const loadSvgForInstance = async () => {
      if (selectedInstance?.sheetId) {
        try {
          setIsLoadingSvg(true);
          const { content, dimensions } = await getSvgForSheet(selectedInstance.sheetId);
          
          if (content) {
            setCurrentSvgContent(content);
          } else {
            // If we failed to load the SVG, fall back to the original
            setCurrentSvgContent(svgContent);
          }
        } catch (error) {
          console.error('Error loading SVG for sheet:', error);
          // Fall back to the original SVG
          setCurrentSvgContent(svgContent);
        } finally {
          setIsLoadingSvg(false);
        }
      } else {
        // If no instance is selected, use the original SVG
        setCurrentSvgContent(svgContent);
      }
    };
    
    loadSvgForInstance();
  }, [selectedInstance, getSvgForSheet, svgContent]);

  // Filter integer patterns that are within the current bounding box
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

  // Generate pattern buttons script
  const patternButtonsScript = React.useMemo(() => {
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
      
      // Create JavaScript object notation directly without using JSON.stringify
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

  // If we have search results, add those to the display as well
  const searchResultsScript = React.useMemo(() => {
    if (!patternSearchResults.length) return '';
    
    // Create virtual pattern buttons for search results
    // If there's a selected instance, center the view around it
    const instanceToShow = selectedInstance || patternSearchResults[0];
    
    if (!instanceToShow) return '';
    
    // Get coordinates for the selected instance and apply transformation
    let centerX = boundingBox.x + (boundingBox.width / 2);
    let centerY = boundingBox.y + (boundingBox.height / 2);
    
    if (instanceToShow && instanceToShow.coordinates && instanceToShow.coordinates.length >= 2 && transformPatternCoordinates) {
      const coords = transformPatternCoordinates(instanceToShow.coordinates, svgDimensions);
      centerX = coords.x;
      centerY = coords.y;
    }
    
    // Create pattern buttons for all search results, highlighting the selected one
    return patternSearchResults.map((result, index) => {
      const isSelected = selectedInstance === result;
      
      // Apply transformation to the result coordinates
      let x = centerX;
      let y = centerY;
      
      if (result.coordinates && result.coordinates.length >= 2 && transformPatternCoordinates) {
        const coords = transformPatternCoordinates(result.coordinates, svgDimensions);
        x = coords.x;
        y = coords.y;
      }
      
      // Escape text for JavaScript string literals
      const patternText = (result.patternText || `Integer-${index}`).replace(/['\\]/g, '\\$&');
      const sheetId = (result.sheetId || '').replace(/['\\]/g, '\\$&');
      
      // Create JavaScript object notation directly without using JSON.stringify
      return `
        createPatternButton(
          'search-${index}', 
          ${x}, 
          ${y}, 
          'integer${isSelected ? "-selected" : ""}', 
          '${patternText} - Sheet: ${sheetId}', 
          {
            patternText: '${patternText}',
            sheetId: '${sheetId}',
            coordinates: [${result.coordinates ? result.coordinates.join(',') : ''}],
            patternType: 'integer',
            isSearchResult: true,
            isSelected: ${isSelected}
          }
        );
        
        // Add label for search result
        const label${index} = document.createElement('div');
        label${index}.style.position = 'absolute';
        label${index}.style.left = '${x + 15}px';
        label${index}.style.top = '${y}px';
        label${index}.style.zIndex = '90';
        label${index}.style.backgroundColor = '${isSelected ? "rgba(59, 130, 246, 0.9)" : "rgba(255,255,255,0.7)"}';
        label${index}.style.color = '${isSelected ? "white" : "black"}';
        label${index}.style.padding = '2px 5px';
        label${index}.style.borderRadius = '3px';
        label${index}.style.fontSize = '10px';
        label${index}.textContent = '${patternText} - Sheet: ${sheetId}';
        document.body.appendChild(label${index});
      `;
    }).join('');
  }, [patternSearchResults, boundingBox, selectedInstance, transformPatternCoordinates, svgDimensions]);

  // Combine all pattern button scripts
  const allPatternsScript = `${patternButtonsScript}\n${searchResultsScript}`;
  
  // Function to handle instance selection
  const handleInstanceSelect = (instance: IntegerPatternSearchResult) => {
    setSelectedInstance(instance);
    
    // Fetch full pattern data for this instance
    if (instance.sheetId && instance.patternText) {
      fetchFullPatternData(instance.sheetId, instance.patternText);
    }
  };
  
  // Create a modified boundingBox centered around the selected instance's coordinates
  const adjustedBoundingBox = React.useMemo(() => {
    if (!selectedInstance || !selectedInstance.coordinates || selectedInstance.coordinates.length < 2) {
      return boundingBox;
    }
    
    // If the selected instance has an enclosing boundingBox, use that
    if (selectedInstance.enclosingBoundingBox) {
      return selectedInstance.enclosingBoundingBox;
    }
    
    // Apply the same transformation to the instance coordinates as we do for patterns
    if (transformPatternCoordinates) {
      const coords = transformPatternCoordinates(selectedInstance.coordinates, svgDimensions);
      const x = coords.x;
      const y = coords.y;
      
      const width = boundingBox.width;
      const height = boundingBox.height;
      
      return {
        ...boundingBox,
        x: x - width / 2,
        y: y - height / 2
      };
    }
    
    // Fallback to original coordinates if no transformation function
    const [x, y] = selectedInstance.coordinates;
    const width = boundingBox.width;
    const height = boundingBox.height;
    
    return {
      ...boundingBox,
      x: x - width / 2,
      y: y - height / 2
    };
  }, [boundingBox, selectedInstance, transformPatternCoordinates, svgDimensions]);

  // Function to fetch full pattern data for a sheet
  const fetchFullPatternData = React.useCallback(async (sheetId: string, patternText: string) => {
    if (fullPatternData.has(sheetId)) {
      return fullPatternData.get(sheetId);
    }
    
    try {
      setIsLoadingPatternData(true);
      const response = await fetch(`/info_extract/info/analysis_${sheetId}.json`);
      if (response.ok) {
        const data = await response.json();
        
        // Find the pattern that matches our text
        const matchingPattern = data.patterns?.find((p: any) => 
          p.pattern_type === 'integers' && p.text === patternText
        );
        
        if (matchingPattern) {
          // Store the full pattern data
          const newData = new Map(fullPatternData);
          newData.set(sheetId, matchingPattern);
          setFullPatternData(newData);
          return matchingPattern;
        }
      }
    } catch (error) {
      console.error('Error fetching pattern data for sheet:', sheetId, error);
    } finally {
      setIsLoadingPatternData(false);
    }
    return null;
  }, [fullPatternData]);

  // Load full pattern data for all instances when they change
  React.useEffect(() => {
    const loadPatternDataForAllInstances = async () => {
      for (const instance of patternSearchResults) {
        if (instance.sheetId && instance.patternText && !fullPatternData.has(instance.sheetId)) {
          await fetchFullPatternData(instance.sheetId, instance.patternText);
        }
      }
    };
    
    if (patternSearchResults.length > 0) {
      loadPatternDataForAllInstances();
    }
  }, [patternSearchResults, fetchFullPatternData, fullPatternData]);

  return (
    <div className="flex h-full">
      {/* Left side - SVG Zoom Window */}
      <div className="flex-1 relative mr-2">
        {isLoadingSvg ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="text-gray-500">Loading sheet {selectedInstance?.sheetId}...</div>
          </div>
        ) : (
          <ZoomWindowIframe
            svgContent={currentSvgContent}
            svgDimensions={currentSvgDimensions}
            boundingBox={adjustedBoundingBox}
            patternButtons={allPatternsScript}
            onPatternClick={onPatternClick}
            sfPatterns={[]}
            cwPatterns={[]}
            integerPatterns={integerPatterns}
            transformPatternCoordinates={transformPatternCoordinates}
            isPatternWithinBoundingBox={isPatternWithinBoundingBox}
            sheetId={selectedInstance?.sheetId}
          />
        )}
      </div>
      
      {/* Right side - Pattern instances sidebar */}
      <div className="w-80 bg-gray-100 overflow-y-auto p-2 border-l border-gray-300">
        <div className="text-sm font-medium mb-2 text-gray-700">Pattern Instances</div>
        
        {patternSearchResults.length === 0 ? (
          <div className="text-sm text-gray-500 italic">No instances found</div>
        ) : (
          <div className="space-y-2">
            {patternSearchResults.map((instance, index) => {
              const fullData = fullPatternData.get(instance.sheetId);
              return (
                <div 
                  key={`${instance.sheetId || 'unknown'}-${index}`}
                  className={`
                    cursor-pointer rounded p-3 text-sm border transition-colors
                    ${selectedInstance === instance 
                      ? 'bg-blue-500 text-white border-blue-600 shadow-md' 
                      : 'bg-white hover:bg-blue-50 border-gray-200 hover:border-blue-300'}
                  `}
                  onClick={() => handleInstanceSelect(instance)}
                >
                  <div className="font-semibold mb-1">
                    {instance.patternText || `Integer-${index}`}
                  </div>
                  <div className={`text-xs mb-2 ${selectedInstance === instance ? 'text-blue-100' : 'text-gray-600'}`}>
                    Sheet: {instance.sheetId || 'Unknown'}
                  </div>
                  
                  {/* Show additional pattern information if available */}
                  {fullData && (
                    <div className={`text-xs space-y-1 ${selectedInstance === instance ? 'text-blue-100' : 'text-gray-600'}`}>
                      {fullData.font && (
                        <div>Font: {fullData.font} ({fullData.size?.toFixed(1)}pt)</div>
                      )}
                      
                      {fullData.shape_analysis && (
                        <div className="mt-2">
                          <div className="font-medium mb-1">Shape Analysis:</div>
                          <div className="pl-2 space-y-1">
                            {fullData.shape_analysis.has_shape && (
                              <div>
                                Type: {fullData.shape_analysis.shape_type || 'Unknown'}
                                {fullData.shape_analysis.confidence && (
                                  <span className="ml-1">
                                    ({Math.round(fullData.shape_analysis.confidence * 100)}%)
                                  </span>
                                )}
                              </div>
                            )}
                            {fullData.shape_analysis.description && (
                              <div className="text-xs italic">
                                {fullData.shape_analysis.description}
                              </div>
                            )}
                            {fullData.shape_analysis.additional_text && fullData.shape_analysis.additional_text.length > 0 && (
                              <div>
                                Additional text: {fullData.shape_analysis.additional_text.join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Show loading indicator if pattern data is being fetched */}
                  {!fullData && isLoadingPatternData && selectedInstance === instance && (
                    <div className={`text-xs ${selectedInstance === instance ? 'text-blue-200' : 'text-gray-500'}`}>
                      Loading details...
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
