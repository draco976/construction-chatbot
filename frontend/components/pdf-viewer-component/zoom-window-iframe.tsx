'use client';

import React from 'react';
import { BoundingBox } from '@/lib/bounding-box';

interface ZoomWindowIframeProps {
  svgContent: string | null;
  svgDimensions: { width: number; height: number };
  boundingBox: BoundingBox;
  patternButtons?: string;
  onPatternClick?: (pattern: any, type: string) => void;
  // Added new props for patterns
  sfPatterns?: any[];
  cwPatterns?: any[];
  integerPatterns?: any[];
  transformPatternCoordinates?: (coords: any, svgDimensions?: { width: number; height: number }) => any;
  isPatternWithinBoundingBox?: (patternCoords: any, boundingBox: BoundingBox, transformFn: any) => boolean;
  // Add sheet ID for fetching patterns
  sheetId?: string;
}

/**
 * Base component for all zoom window iframes
 * This component provides the core functionality for zooming and panning a SVG
 */
export const ZoomWindowIframe: React.FC<ZoomWindowIframeProps> = ({
  svgContent,
  svgDimensions,
  boundingBox,
  patternButtons = '',
  onPatternClick,
  // Use the new pattern props
  sfPatterns = [],
  cwPatterns = [],
  integerPatterns = [],
  transformPatternCoordinates,
  isPatternWithinBoundingBox,
  sheetId
}) => {
  // State to hold fetched patterns
  svgDimensions = { width: 3024, height: 2160 };
  const [fetchedPatterns, setFetchedPatterns] = React.useState<{
    sf: any[];
    cw: any[];
    integer: any[];
  }>({ sf: [], cw: [], integer: [] });

  // Fetch patterns from analysis file when sheetId is provided
  React.useEffect(() => {
    if (sheetId) {
      const fetchPatterns = async () => {
        try {
          // Extract page number from sheetId (e.g., "page_006" -> "006")
          const pageNumber = sheetId.replace('page_', '');
          const response = await fetch(`/info_extract/info/analysis_page_${pageNumber}.json`);
          if (response.ok) {
            const data = await response.json();
            
            // Extract and categorize patterns from the analysis data
            const allPatterns = data.patterns || [];
            
            const sfPatterns = allPatterns.filter((p: any) => p.pattern_type === 'sf_patterns');
            const cwPatterns = allPatterns.filter((p: any) => p.pattern_type === 'cw_patterns');
            const integerPatterns = allPatterns.filter((p: any) => p.pattern_type === 'integers');
            
            setFetchedPatterns({
              sf: sfPatterns,
              cw: cwPatterns,
              integer: integerPatterns
            });
          } else {
            console.warn('Failed to fetch patterns for sheet', sheetId, 'HTTP status:', response.status);
          }
        } catch (error) {
          console.error('Error fetching patterns for sheet', sheetId, ':', error);
        }
      };
      
      fetchPatterns();
    }
  }, [sheetId]);

  // Use fetched patterns if available, otherwise fall back to props
  const finalSfPatterns = sheetId ? fetchedPatterns.sf : sfPatterns;
  const finalCwPatterns = sheetId ? fetchedPatterns.cw : cwPatterns;
  const finalIntegerPatterns = sheetId ? fetchedPatterns.integer : integerPatterns;

  // Generate pattern data for the iframe
  const patternData = React.useMemo(() => {
    if (!transformPatternCoordinates || !isPatternWithinBoundingBox) {
      return [];
    }
    
    // Filter patterns that are within the bounding box
    const visibleSfPatterns = finalSfPatterns; // Temporarily bypass filter
    const visibleCwPatterns = finalCwPatterns; // Temporarily bypass filter
    const visibleIntegerPatterns = finalIntegerPatterns; // Temporarily bypass filter
    
    // TODO: Re-enable filter after coordinate system is updated
    // const visibleSfPatterns = sfPatterns.filter(pattern => 
    //   isPatternWithinBoundingBox(
    //     pattern.coordinates, 
    //     boundingBox,
    //     transformPatternCoordinates
    //   )
    // );
    
    const allPatterns = [
      ...visibleSfPatterns.map(pattern => {
        const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
        
        // Store raw sheet coordinates once
        const x = coords.x;
        const y = coords.y;
        
        // Extract sheet code from pattern text if available
        let extractedSheetCode = '';
        if (pattern.text) {
          const sheetCodeMatch = pattern.text.match(/[A-Z]-\d+\.?\d*|[A-Z]\d+\.\d+/);
          if (sheetCodeMatch && sheetCodeMatch.length > 0) {
            extractedSheetCode = sheetCodeMatch[0];
          }
        }
        
        return {
          ...pattern,
          type: 'sf',
          x,            // ← store as flat numbers
          y,
          coordinates: coords,
          originalCoordinates: pattern.coordinates, // Keep original for nested transforms
          extractedSheetCode
        };
      }),
      ...visibleCwPatterns.map(pattern => {
        const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
        
        // Store raw sheet coordinates once
        const x = coords.x;
        const y = coords.y;
        
        // Extract sheet code from pattern text if available
        let extractedSheetCode = '';
        if (pattern.text) {
          const sheetCodeMatch = pattern.text.match(/[A-Z]-\d+\.?\d*|[A-Z]\d+\.\d+/);
          if (sheetCodeMatch && sheetCodeMatch.length > 0) {
            extractedSheetCode = sheetCodeMatch[0];
          }
        }
        
        return {
          ...pattern,
          type: 'cw',
          x,            // ← store as flat numbers
          y,
          coordinates: coords,
          originalCoordinates: pattern.coordinates, // Keep original for nested transforms
          extractedSheetCode
        };
      }),
      ...visibleIntegerPatterns.map(pattern => {
        const coords = transformPatternCoordinates(pattern.coordinates, svgDimensions);
        
        // Store raw sheet coordinates once
        const x = coords.x;
        const y = coords.y;
        
        // Extract sheet code from pattern text if available
        let extractedSheetCode = '';
        if (pattern.text) {
          const sheetCodeMatch = pattern.text.match(/[A-Z]-\d+\.?\d*|[A-Z]\d+\.\d+/);
          if (sheetCodeMatch && sheetCodeMatch.length > 0) {
            extractedSheetCode = sheetCodeMatch[0];
          }
        }
        
        return {
          ...pattern,
          type: 'integer',
          x,            // ← store as flat numbers
          y,
          coordinates: coords,
          originalCoordinates: pattern.coordinates, // Keep original for nested transforms
          extractedSheetCode,
          patternType: 'integer'
        };
      })
    ];
    
    return allPatterns;
  }, [
    finalSfPatterns, 
    finalCwPatterns, 
    finalIntegerPatterns, 
    boundingBox, 
    transformPatternCoordinates, 
    isPatternWithinBoundingBox,
    svgDimensions
  ]);
  
  // Add effect for handling pattern click messages from the iframe
  React.useEffect(() => {
    // Handler for pattern click messages from iframe
    const handlePatternClick = (event: MessageEvent) => {
      
      // Check if the message is from our iframe
      if (event.data && event.data.action === 'patternClick') {
        
        // Add debugging info about the pattern
        
        // Check if onPatternClick is available
        if (onPatternClick) {
          onPatternClick(event.data.pattern, event.data.type);
        } else {
          console.error("onPatternClick handler is not available!");
        }
      }
    };

    // Create a global handler for direct access from the iframe
    (window as any).handlePatternClickFromIframe = (pattern: any, type: string) => {
      onPatternClick?.(pattern, type);
    };
    
    // Add event listener to the global window object
    global.window.addEventListener('message', handlePatternClick);
    
    // Clean up event listener on unmount
    return () => {
      global.window.removeEventListener('message', handlePatternClick);
      delete (window as any).handlePatternClickFromIframe;
    };
  }, [onPatternClick]);

  // Wait until patterns are ready
  const dataReady = 
    (sheetId && fetchedPatterns.sf.length + fetchedPatterns.cw.length + fetchedPatterns.integer.length > 0) ||
    !sheetId;           // no sheetId ⇒ we use props immediately

  if (!dataReady) {
    return <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
             Loading patterns…
           </div>;
  }

  // Return the iframe with the SVG content
  return (
    <div className="absolute inset-0 overflow-hidden">
      <iframe
        key={sheetId ?? 'zoom-iframe'}
        srcDoc={`
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body, html { 
                margin: 0; 
                padding: 0; 
                overflow: hidden;
                width: 100%;
                height: 100%;
                user-select: none;
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
              }
              .svg-container {
                transform-origin: 0 0;
                position: absolute;
                width: ${svgDimensions.width}px;
                height: ${svgDimensions.height}px;
                overflow: visible;
                cursor: grab;
                user-select: none;
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
              }
              .svg-container.grabbing {
                cursor: grabbing;
              }
              .svg-container svg {
                width: 100%;
                height: 100%;
              }
              .highlight-box {
                position: absolute;
                border: 2px dashed blue;
                left: ${boundingBox.x}px;
                top: ${boundingBox.y}px;
                width: ${boundingBox.width}px;
                height: ${boundingBox.height}px;
                pointer-events: none;
                z-index: 5;
              }
              .title-overlay {
                position: absolute;
                top: 5px;
                left: 5px;
                background-color: rgba(59, 130, 246, 0.8);
                color: white;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 12px;
                font-family: sans-serif;
                z-index: 10;
              }
              .zoom-controls {
                position: absolute;
                bottom: 10px;
                right: 10px;
                display: flex;
                gap: 5px;
                z-index: 20;
              }
              .zoom-button {
                background: rgba(255, 255, 255, 0.8);
                border: 1px solid #ccc;
                border-radius: 4px;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                cursor: pointer;
                user-select: none;
              }
              .zoom-button:hover {
                background: rgba(240, 240, 240, 0.9);
              }
              /* SVG Pattern styles - loud test colors */
              .pat--sf {
                fill: #ff0000;
                stroke: #000;
                stroke-width: 2;
                opacity: 0.8;
                cursor: pointer;
              }
              .pat--cw {
                fill: #00ff00;
                stroke: #000;
                stroke-width: 2;
                opacity: 0.8;
                cursor: pointer;
              }
              .pat--integer {
                fill: #0000ff;
                stroke: #000;
                stroke-width: 2;
                opacity: 0.8;
                cursor: pointer;
              }
              .pat--selected {
                fill: #ef4444;
                stroke: #dc2626;
                stroke-width: 2;
                opacity: 1;
              }
              .pat--sf:hover,
              .pat--cw:hover,
              .pat--integer:hover {
                opacity: 1;
                stroke-width: 3;
              }
              /* Pattern info tooltip */
              .pattern-tooltip {
                position: absolute;
                background-color: rgba(0, 0, 0, 0.75);
                color: white;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s ease;
                z-index: 25;
                max-width: 200px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
            </style>
          </head>
          <body>
            <div class="svg-container">
              <!-- SVG overlay for patterns -->
              <svg
                id="pattern-layer"
                width="${svgDimensions.width}"
                height="${svgDimensions.height}"
                viewBox="0 0 ${svgDimensions.width} ${svgDimensions.height}"
                style="position:absolute;top:0;left:0;z-index:10"
              >
                <g id="patterns"></g>
              </svg>
              ${svgContent || ''}
            </div>
            <div class="highlight-box"></div>
            <div class="title-overlay">
              ${boundingBox.title || boundingBox.code || 'Zoomed view'}
            </div>
            <div class="zoom-controls">
              <div class="zoom-button" id="zoom-in">+</div>
              <div class="zoom-button" id="zoom-out">-</div>
              <div class="zoom-button" id="zoom-reset">⟲</div>
            </div>
            <div id="pattern-tooltip" class="pattern-tooltip"></div>
            <script>
              /* ⬇️ all numbers are already in page-pixel space */
              const PATTERNS = ${JSON.stringify(patternData)};
              const svgDimensions = ${JSON.stringify(svgDimensions)};
              
              // Add unique identifier to track iframe reloads
              const iframeId = 'iframe_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
              console.log('Iframe initialized with ID:', iframeId);
              
              // Check if window already has a zoom iframe to prevent duplicates
              if (window.parent && window.parent.document) {
                const existingIframes = window.parent.document.querySelectorAll('iframe[src*="srcdoc"]');
                console.log('Existing zoom iframes found:', existingIframes.length);
                if (existingIframes.length > 1) {
                  console.warn('Multiple zoom iframes detected - this may cause conflicts');
                }
              }
              
              // Initial setup for zoom and pan
              let scale = 1; // Set initial scale to 1 (no zoom)
              let offsetX = 0; // Start centered
              let offsetY = 0; // Start centered
              let isDragging = false;
              let startX, startY;
              let lastOffsetX = offsetX;
              let lastOffsetY = offsetY;
              let zoomEnabled = false; // Block zoom until auto-zoom completes
              
              // Get the SVG container
              const container = document.querySelector('.svg-container');
              const tooltip = document.getElementById('pattern-tooltip');
              
              // Add debug message to check if script is executing
              
              // Don't apply initial transform here - let auto-zoom handle it
              // updateTransform(); // Removed to prevent conflict with auto-zoom
              
              // Function to update the transform
              function updateTransform() {
                try {
                  if (!container) {
                    console.error('Container element not found, cannot update transform');
                    return;
                  }
                  
                  // CSS transform order is evaluated right → left, so scale happens first, then translate
                  const transform = \`translate(\${offsetX}px, \${offsetY}px) scale(\${scale})\`;
                  container.style.transform = transform;
                  console.log('Transform updated:', transform);
                  console.log('Container element:', container);
                  console.log('Container style after transform:', container.style.transform);
                  
                  // Add a delay to check if transform persists
                  setTimeout(() => {
                    const currentTransform = container.style.transform;
                    console.log('Transform check after 1 second:', currentTransform);
                    
                    // Check for significant changes, not just precision differences
                    if (currentTransform && transform) {
                      const currentScale = parseFloat(currentTransform.match(/scale\(([\d.]+)\)/)?.[1] || '1');
                      const expectedScale = parseFloat(transform.match(/scale\(([\d.]+)\)/)?.[1] || '1');
                      
                      if (Math.abs(currentScale - expectedScale) > 0.01) {
                        console.error('Transform was significantly overridden! Expected scale:', expectedScale, 'Got scale:', currentScale);
                        console.error('Expected:', transform, 'Got:', currentTransform);
                      } else {
                        console.log('Transform maintained (minor precision differences are normal)');
                      }
                    }
                  }, 1000);
                } catch (error) {
                  console.error('Error updating transform:', error);
                }
              }

              // Function to create SVG pattern markers
              function createPatternMarkers() {
                const patternLayer = document.getElementById('patterns');
                if (!patternLayer) {
                  console.error('Pattern layer not found');
                  return;
                }


                // Clear existing patterns
                patternLayer.innerHTML = '';

                PATTERNS.forEach((p, index) => {
                  // Use the pre-calculated raw sheet coordinates
                  const x = p.x;
                  const y = p.y;

                  
                  /* ---------------------------------------------------------- */
                  let el;
                  try {
                    if (p.type === 'integer') {
                      el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                      if (el) {
                        el.setAttribute('x', x - 7);
                        el.setAttribute('y', y - 7);
                        el.setAttribute('width', 14);
                        el.setAttribute('height', 14);
                        el.setAttribute('transform', \`rotate(45 \${x} \${y})\`);
                        el.classList.add('pat--integer');
                      }
                    } else {
                      el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                      if (el) {
                        el.setAttribute('cx', x);
                        el.setAttribute('cy', y);
                        el.setAttribute('r', 7);
                        el.classList.add(\`pat--\${p.type}\`);
                      }
                    }
                  } catch (error) {
                    console.error('Error creating SVG element:', error);
                    return; // Skip this pattern if we can't create the element
                  }

                  // Skip if element creation failed
                  if (!el) {
                    console.warn('Failed to create SVG element for pattern:', p);
                    return;
                  }

                  // Store pattern data
                  el.dataset.pattern = JSON.stringify(p);
                  
                  // Add click handler
                  el.addEventListener('click', e => {
                    e.stopPropagation();
                    
                    console.log('Pattern clicked in iframe:', p);
                    
                    // Send message to parent window
                    window.parent.postMessage(
                      { action: 'patternClick', pattern: p, type: p.type },
                      '*'
                    );
                  });

                  // Add hover events for tooltip
                  el.addEventListener('mouseenter', e => {
                    const tooltip = document.getElementById('pattern-tooltip');
                    tooltip.textContent = p.text || p.type;
                    tooltip.style.opacity = '1';
                    tooltip.style.left = (e.clientX + 10) + 'px';
                    tooltip.style.top = (e.clientY + 10) + 'px';
                  });
                  
                  el.addEventListener('mousemove', e => {
                    const tooltip = document.getElementById('pattern-tooltip');
                    tooltip.style.left = (e.clientX + 10) + 'px';
                    tooltip.style.top = (e.clientY + 10) + 'px';
                  });
                  
                  el.addEventListener('mouseleave', () => {
                    const tooltip = document.getElementById('pattern-tooltip');
                    tooltip.style.opacity = '0';
                  });

                  patternLayer.appendChild(el);
                });
                
              }
              
              // Handle mouse wheel for zooming with non-passive listener
              document.addEventListener('wheel', function(e) {
                try {
                  // Block wheel events until auto-zoom completes
                  if (!zoomEnabled) {
                    console.log('Wheel event blocked - auto-zoom not yet complete');
                    e.preventDefault(); // Still prevent default to avoid outer page scroll
                    return;
                  }
                  
                  // Prevent default scrolling behavior
                  e.preventDefault();
                  e.stopPropagation();
                  
                  // Get mouse position relative to the iframe window
                  const mouseX = e.clientX;
                  const mouseY = e.clientY;
                  
                  // Calculate the point in the original SVG coordinate system that's under the cursor
                  // Correct formula for scale → translate transform order
                  const worldX = (mouseX - offsetX) / scale;
                  const worldY = (mouseY - offsetY) / scale;
                  
                  // Store the old scale
                  const oldScale = scale;
                  
                  // Adjust scale based on wheel direction
                  const scaleBy = 1.1;
                  if (e.deltaY < 0) {
                    scale *= scaleBy;
                  } else {
                    scale /= scaleBy;
                  }
                  
                  // Clamp scale to reasonable limits
                  scale = Math.max(0.5, Math.min(10, scale));
                  
                  // Calculate new offset to keep the world point under the cursor
                  // Correct formula for scale → translate transform order
                  offsetX = mouseX - worldX * scale;
                  offsetY = mouseY - worldY * scale;
                  
                  updateTransform();
                } catch (error) {
                  console.error('Error handling wheel event:', error);
                }
              }, { passive: false });
              
              // Handle mouse down for panning
              container.addEventListener('mousedown', function(e) {
                // Block mouse events until auto-zoom completes
                if (!zoomEnabled) {
                  console.log('Mouse event blocked - auto-zoom not yet complete');
                  return;
                }
                
                // Don't initiate drag if clicking on a pattern
                if (e.target.classList.contains('pattern-button')) {
                  return;
                }
                
                e.preventDefault();
                e.stopPropagation();
                
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                lastOffsetX = offsetX;
                lastOffsetY = offsetY;
                container.classList.add('grabbing');
              });
              
              // Handle mouse move for panning
              document.addEventListener('mousemove', function(e) {
                if (!isDragging) return;
                
                e.preventDefault();
                e.stopPropagation();                  const dx = e.clientX - startX;
                  const dy = e.clientY - startY;
                  
                  // Correct panning formula for scale → translate transform order
                  // No division by scale needed since translation happens after scaling
                  offsetX = lastOffsetX + dx;
                  offsetY = lastOffsetY + dy;
                
                updateTransform();
              });
              
              // Handle mouse up to end panning
              document.addEventListener('mouseup', function(e) {
                if (isDragging) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                isDragging = false;
                container.classList.remove('grabbing');
              });
              
              // Handle mouse leave to end panning
              container.addEventListener('mouseleave', function(e) {
                if (isDragging) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                isDragging = false;
                container.classList.remove('grabbing');
              });
              
              // Touch support for mobile devices
              let lastTouchDistance = 0;
              
              container.addEventListener('touchstart', function(e) {
                // Block touch events until auto-zoom completes
                if (!zoomEnabled) {
                  console.log('Touch event blocked - auto-zoom not yet complete');
                  return;
                }
                
                if (e.touches.length === 1) {
                  // Single touch - start panning
                  isDragging = true;
                  startX = e.touches[0].clientX;
                  startY = e.touches[0].clientY;
                  lastOffsetX = offsetX;
                  lastOffsetY = offsetY;
                  container.classList.add('grabbing');
                } else if (e.touches.length === 2) {
                  // Two touches - start zooming
                  isDragging = false;
                  const touch1 = e.touches[0];
                  const touch2 = e.touches[1];
                  lastTouchDistance = Math.sqrt(
                    Math.pow(touch2.clientX - touch1.clientX, 2) + 
                    Math.pow(touch2.clientY - touch1.clientY, 2)
                  );
                }
                e.preventDefault();
              }, { passive: false });
              
              container.addEventListener('touchmove', function(e) {
                if (e.touches.length === 1 && isDragging) {
                  // Single touch - panning
                  const dx = e.touches[0].clientX - startX;
                  const dy = e.touches[0].clientY - startY;
                  
                  // Correct panning formula for scale → translate transform order
                  // No division by scale needed since translation happens after scaling
                  offsetX = lastOffsetX + dx;
                  offsetY = lastOffsetY + dy;
                  
                  updateTransform();
                } else if (e.touches.length === 2) {
                  // Two touches - zooming
                  const touch1 = e.touches[0];
                  const touch2 = e.touches[1];
                  const currentDistance = Math.sqrt(
                    Math.pow(touch2.clientX - touch1.clientX, 2) + 
                    Math.pow(touch2.clientY - touch1.clientY, 2)
                  );
                  
                  if (lastTouchDistance > 0) {
                    // Get the center point between the two touches
                    const centerX = (touch1.clientX + touch2.clientX) / 2;
                    const centerY = (touch1.clientY + touch2.clientY) / 2;
                    
                    // Calculate the point in the original SVG coordinate system that's under the center
                    // Correct formula for scale → translate transform order
                    const worldX = (centerX - offsetX) / scale;
                    const worldY = (centerY - offsetY) / scale;
                    
                    // Apply zoom
                    const scaleChange = currentDistance / lastTouchDistance;
                    const oldScale = scale;
                    scale = Math.max(0.5, Math.min(10, scale * scaleChange));
                    
                    // Calculate new offset to keep the world point under the center
                    // Correct formula for scale → translate transform order
                    offsetX = centerX - worldX * scale;
                    offsetY = centerY - worldY * scale;
                    
                    updateTransform();
                  }
                  
                  lastTouchDistance = currentDistance;
                }
                e.preventDefault();
              }, { passive: false });
              
              container.addEventListener('touchend', function(e) {
                isDragging = false;
                lastTouchDistance = 0;
                container.classList.remove('grabbing');
                e.preventDefault();
              }, { passive: false });
              
              // Zoom control buttons
              document.getElementById('zoom-in').addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Get the center of the iframe window
                const centerX = window.innerWidth / 2;
                const centerY = window.innerHeight / 2;
                
                // Calculate the point in the original SVG coordinate system that's under the center
                // Correct formula for scale → translate transform order
                const worldX = (centerX - offsetX) / scale;
                const worldY = (centerY - offsetY) / scale;
                
                // Apply zoom
                const oldScale = scale;
                scale = Math.min(10, scale * 1.2);
                
                // Calculate new offset to keep the world point centered
                // Correct formula for scale → translate transform order
                offsetX = centerX - worldX * scale;
                offsetY = centerY - worldY * scale;
                
                updateTransform();
              });
              
              document.getElementById('zoom-out').addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Get the center of the iframe window
                const centerX = window.innerWidth / 2;
                const centerY = window.innerHeight / 2;
                
                // Calculate the point in the original SVG coordinate system that's under the center
                // Correct formula for scale → translate transform order
                const worldX = (centerX - offsetX) / scale;
                const worldY = (centerY - offsetY) / scale;
                
                // Apply zoom
                const oldScale = scale;
                scale = Math.max(0.5, scale / 1.2);
                
                // Calculate new offset to keep the world point centered
                // Correct formula for scale → translate transform order
                offsetX = centerX - worldX * scale;
                offsetY = centerY - worldY * scale;
                
                updateTransform();
              });
              
              document.getElementById('zoom-reset').addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Only allow zoom reset if auto-zoom is completed
                if (autoZoomCompleted) {
                  console.log('Manual zoom reset clicked');
                  scale = 1;
                  offsetX = 0;
                  offsetY = 0;
                  updateTransform();
                } else {
                  console.log('Zoom reset blocked - auto-zoom not completed');
                }
              });

              // Auto-zoom to bounding box with some zoom out
              let autoZoomCompleted = false; // Flag to prevent multiple calls
              
              function autoZoomToBoundingBox() {
                if (autoZoomCompleted) {
                  console.log('Auto-zoom already completed, skipping');
                  return;
                }
                
                // Check if container exists
                if (!container) {
                  console.error('Container not found! Cannot apply auto-zoom.');
                  return;
                }
                
                // Check if container already has the correct transform
                const currentTransform = container.style.transform;
                console.log('Current container transform:', currentTransform);
                
                if (currentTransform && currentTransform.includes('scale(0.5)')) {
                  console.log('Container already has auto-zoom transform, skipping');
                  autoZoomCompleted = true;
                  return;
                }
                
                const boundingBox = ${JSON.stringify(boundingBox)};
                const svgDimensions = ${JSON.stringify(svgDimensions)};
                
                console.log('Auto-zooming to bounding box:', boundingBox);
                console.log('SVG dimensions:', svgDimensions);
                console.log('Current viewport size:', window.innerWidth, 'x', window.innerHeight);
                console.log('Container found:', container);
                
                // Check if the bounding box is too small (likely a pattern element)
                const isSmallPattern = boundingBox.width < 50 || boundingBox.height < 50;
                console.log('Is small pattern?', isSmallPattern, 'Width:', boundingBox.width, 'Height:', boundingBox.height);
                
                let adjustedBoundingBox;
                if (isSmallPattern) {
                  // Create a larger bounding box around the small pattern
                  const expandSize = 300; // Expand by 300px in each direction
                  adjustedBoundingBox = {
                    x: Math.max(0, boundingBox.x - expandSize),
                    y: Math.max(0, boundingBox.y - expandSize),
                    width: Math.min(svgDimensions.width, boundingBox.width + expandSize * 2),
                    height: Math.min(svgDimensions.height, boundingBox.height + expandSize * 2)
                  };
                  console.log('Adjusted bounding box for small pattern:', adjustedBoundingBox);
                } else {
                  adjustedBoundingBox = boundingBox;
                  console.log('Using original bounding box (large enough)');
                }
                
                // Calculate the center of the adjusted bounding box in SVG coordinates
                const centerX = adjustedBoundingBox.x + adjustedBoundingBox.width / 2;
                const centerY = adjustedBoundingBox.y + adjustedBoundingBox.height / 2;
                
                console.log('Adjusted bounding box center:', centerX, centerY);
                
                // Calculate the zoom scale to fit the adjusted bounding box with minimal padding
                const padding = 20; // Reduced padding from 50 to 20 pixels for closer view
                const scaleX = (window.innerWidth - padding * 2) / adjustedBoundingBox.width;
                const scaleY = (window.innerHeight - padding * 2) / adjustedBoundingBox.height;
                
                // Use the smaller scale to ensure both dimensions fit, with much more zoom in
                const targetScale = Math.min(scaleX, scaleY) * 0.8; // 0.8 to show the whole bounding box with some margin
                
                console.log('Calculated scales - X:', scaleX, 'Y:', scaleY, 'Target:', targetScale);
                
                // Clamp the scale to reasonable limits
                scale = Math.max(0.5, Math.min(25, targetScale)); // Increased max scale to 25 for very high zoom
                
                // Calculate offset to center the bounding box in the viewport
                offsetX = window.innerWidth / 2 - centerX * scale;
                offsetY = window.innerHeight / 2 - centerY * scale;
                
                console.log('Applied zoom - Scale:', scale, 'Offset X:', offsetX, 'Offset Y:', offsetY);
                
                console.log('About to call updateTransform()');
                
                updateTransform();
                autoZoomCompleted = true; // Mark as completed
                zoomEnabled = true; // Enable wheel/touch zoom after auto-zoom is complete
                
                console.log('Auto-zoom completed successfully');
                console.log('Zoom interactions now enabled');
                
                // Store the expected transform for comparison (with some tolerance for precision)
                const expectedTransform = container.style.transform;
                console.log('Expected transform after auto-zoom:', expectedTransform);
                
                // Monitor for unwanted transform changes
                const monitorTransform = () => {
                  const currentTransform = container.style.transform;
                  
                  // Check if transform changed significantly (not just precision)
                  if (currentTransform && expectedTransform) {
                    const currentScale = parseFloat(currentTransform.match(/scale\(([\d.]+)\)/)?.[1] || '1');
                    const expectedScale = parseFloat(expectedTransform.match(/scale\(([\d.]+)\)/)?.[1] || '1');
                    
                    // If scale changed by more than 0.01, it's a real override
                    if (Math.abs(currentScale - expectedScale) > 0.01) {
                      console.error('Transform was significantly overridden!');
                      console.error('Expected scale:', expectedScale, 'Got scale:', currentScale);
                      console.error('Expected:', expectedTransform);
                      console.error('Got:', currentTransform);
                    }
                  }
                };
                
                // Check after 1 second and then every 2 seconds for 10 seconds
                setTimeout(monitorTransform, 1000);
                setTimeout(monitorTransform, 3000);
                setTimeout(monitorTransform, 5000);
                setTimeout(monitorTransform, 7000);
                setTimeout(monitorTransform, 10000);
              }

              // Initialize with a longer delay to ensure DOM is fully ready
              setTimeout(function() {
                console.log('=== ZOOM WINDOW INITIALIZATION START ===');
                console.log('Iframe ID:', iframeId);
                console.log('Zoom enabled:', zoomEnabled);
                console.log('Setting up all event listeners first...');
                
                // All event listeners are now set up, run auto-zoom with additional delay
                setTimeout(function() {
                  console.log('=== AUTO-ZOOM EXECUTION START ===');
                  console.log('Running auto-zoom after all setup is complete...');
                  autoZoomToBoundingBox();
                  
                  // Create SVG pattern markers after auto-zoom is complete
                  setTimeout(function() {
                    console.log('=== PATTERN MARKERS CREATION START ===');
                    console.log('Creating pattern markers after auto-zoom...');
                    createPatternMarkers();
                    console.log('=== INITIALIZATION COMPLETE ===');
                  }, 100);
                }, 300); // Additional delay for auto-zoom
              }, 200); // Initial delay for DOM readiness
            </script>
          </body>
          </html>
        `}
        style={{
          width: '100%',
          height: '100%',
          border: 'none'
        }}
      />
    </div>
  );
};
