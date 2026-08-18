import React, { useEffect, useRef, useState } from 'react';

export default function MediaViewer({ 
  isOpen, 
  mediaList, 
  activeIndex, 
  onClose, 
  onPrev, 
  onNext,
  onDownload 
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  
  // Zoom & Pan states
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  
  // Drag threshold helper to distinguish between a drag release and a single click
  const hasDraggedRef = useRef(false);

  // Touch swipe states
  const swipeStartXRef = useRef(0);
  const swipeStartYRef = useRef(0);
  const swipeTimeRef = useRef(0);
  const isSwipingRef = useRef(false);

  // Touch pinch zoom metadata
  const pinchRef = useRef({ initialDistance: 0, initialScale: 1 });

  // Custom cursor styling state
  const [cursorStyle, setCursorStyle] = useState({});

  // Slide transition animation helper states
  const [animationClass, setAnimationClass] = useState('scale-in');
  const prevIndexRef = useRef(activeIndex);

  const currentMsg = mediaList && mediaList.length > 0 ? mediaList[activeIndex] : null;
  const displayName = currentMsg ? currentMsg.content.replace(/^\d+_/, '') : '';
  const isVideo = currentMsg?.type === 'VIDEO';

  // Compare indexes when activeIndex changes to choose slide animation direction
  useEffect(() => {
    if (!isOpen) {
      setAnimationClass('scale-in');
      return;
    }
    
    if (activeIndex > prevIndexRef.current) {
      setAnimationClass('animate-slide-right');
    } else if (activeIndex < prevIndexRef.current) {
      setAnimationClass('animate-slide-left');
    } else {
      setAnimationClass('scale-in');
    }
    prevIndexRef.current = activeIndex;
  }, [activeIndex, isOpen]);

  // Reset zoom on active index change or viewer close
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setIsDragging(false);
    setCursorStyle({});
    pinchRef.current = { initialDistance: 0, initialScale: 1 };
    hasDraggedRef.current = false;
    isSwipingRef.current = false;
  }, [activeIndex, isOpen]);

  // Keyboard navigation listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') {
        onPrev();
      } else if (e.key === 'ArrowRight') {
        onNext();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onPrev, onNext, onClose]);

  // Pause video when media changed or closed
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
  }, [isOpen, activeIndex]);

  // Robust window-level wheel event listener for zooming (avoids ref mounting races)
  useEffect(() => {
    if (!isOpen || isVideo) return;

    const onWheelEvent = (e) => {
      const overlay = e.target.closest('#media-viewer-overlay');
      if (!overlay) return;

      e.preventDefault();
      const zoomIntensity = 0.0025;
      
      setScale(prev => {
        const nextScale = Math.max(1, Math.min(8, prev + e.deltaY * -zoomIntensity));
        if (nextScale === 1) {
          setOffset({ x: 0, y: 0 });
        }
        return nextScale;
      });
    };

    window.addEventListener('wheel', onWheelEvent, { passive: false });
    return () => {
      window.removeEventListener('wheel', onWheelEvent);
    };
  }, [isOpen, isVideo]);

  // Early return placed AFTER all React hooks are defined to satisfy Rules of Hooks
  if (!isOpen || !mediaList || mediaList.length === 0) return null;

  // Mouse move region checker to transform cursor icon into premium custom arrows
  const handleMouseMove = (e) => {
    if (!e.target || typeof e.target.closest !== 'function') return;

    if (e.target.closest('.toolbar-button-container') || e.target.closest('button')) {
      setCursorStyle({ cursor: 'pointer' });
      return;
    }

    if (scale > 1 && !isVideo) {
      setCursorStyle({ cursor: isDragging ? 'grabbing' : 'grab' });
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;

    // High contrast white arrows with black outline SVGs (URL-encoded to prevent crashes)
    if (relativeX < 0.3) {
      setCursorStyle({ 
        cursor: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'%3E%3Cpath d='M19 12H5M12 19l-7-7 7-7' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M19 12H5M12 19l-7-7 7-7' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 16 16, w-resize` 
      });
    } else if (relativeX > 0.7) {
      setCursorStyle({ 
        cursor: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'%3E%3Cpath d='M5 12h14M12 5l7 7-7 7' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M5 12h14M12 5l7 7-7 7' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 16 16, e-resize` 
      });
    } else {
      setCursorStyle({ cursor: 'zoom-out' });
    }
  };

  // Drag, Pan, Touch Pinch-to-Zoom, and Swipe Page Turn handlers
  const handleDragStart = (e) => {
    if (isVideo) return;

    if (e.type === 'touchstart' && e.touches.length === 2) {
      // Dual touches: initialize pinch-to-zoom
      setIsDragging(false);
      isSwipingRef.current = false;
      hasDraggedRef.current = true;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchRef.current = {
        initialDistance: dist,
        initialScale: scale
      };
      return;
    }

    if (scale <= 1) {
      if (e.type === 'touchstart' && e.touches.length === 1) {
        // Start tracking swipe page turn gesture on mobile at scale 1
        swipeStartXRef.current = e.touches[0].clientX;
        swipeStartYRef.current = e.touches[0].clientY;
        swipeTimeRef.current = Date.now();
        isSwipingRef.current = true;
        hasDraggedRef.current = false;
      }
      return;
    }

    e.preventDefault();
    setIsDragging(true);
    hasDraggedRef.current = false; 
    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { x: clientX, y: clientY };
  };

  const handleDragMove = (e) => {
    if (isVideo) return;

    if (e.type === 'touchmove' && e.touches.length === 2) {
      // Dual touches: update pinch-to-zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const initial = pinchRef.current;
      if (initial.initialDistance > 0) {
        const ratio = dist / initial.initialDistance;
        const nextScale = Math.max(1, Math.min(8, initial.initialScale * ratio));
        setScale(nextScale);
        if (nextScale === 1) {
          setOffset({ x: 0, y: 0 });
        }
      }
      return;
    }

    if (scale <= 1) return;

    if (!isDragging) return;
    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      hasDraggedRef.current = true;
    }

    setOffset(prev => ({
      x: prev.x + dx,
      y: prev.y + dy
    }));
    dragStartRef.current = { x: clientX, y: clientY };
  };

  const handleDragEnd = (e) => {
    setIsDragging(false);
    pinchRef.current = { initialDistance: 0, initialScale: 1 };

    if (scale <= 1 && isSwipingRef.current) {
      isSwipingRef.current = false;
      const touch = e.changedTouches && e.changedTouches[0];
      if (touch) {
        const dx = touch.clientX - swipeStartXRef.current;
        const dy = touch.clientY - swipeStartYRef.current;
        const dt = Date.now() - swipeTimeRef.current;

        // Swipe threshold: distance > 50px, mostly horizontal, duration < 500ms
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
          hasDraggedRef.current = true; // Mark as dragged so we don't trigger click close
          if (dx > 0) {
            onPrev(); // Swipe Right -> Prev
          } else {
            onNext(); // Swipe Left -> Next
          }
        }
      }
    }
  };

  // Click region action coordinator (handles zoom reset before flipping/closing)
  const handleContainerClick = (e) => {
    if (!e.target || typeof e.target.closest !== 'function') return;
    if (e.target.closest('button')) return;
    
    const videoEl = e.target.closest('video');
    if (videoEl && e.nativeEvent.offsetY > videoEl.clientHeight - 50) {
      return;
    }

    if (hasDraggedRef.current) {
      // Releasing drag/swipe fires click. Reset flag and consume event.
      hasDraggedRef.current = false;
      return;
    }

    if (scale > 1) {
      // Zoomed in: Click once to zoom out back to full screen
      setScale(1);
      setOffset({ x: 0, y: 0 });
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;

    if (relativeX < 0.3) {
      onPrev();
    } else if (relativeX > 0.7) {
      onNext();
    } else {
      onClose();
    }
  };

  return (
    <div 
      ref={containerRef}
      id="media-viewer-overlay"
      className="fixed inset-0 bg-black/95 z-[999] flex flex-col justify-between p-2 sm:p-4 animate-fade-in select-none"
      onClick={handleContainerClick}
      onMouseMove={handleMouseMove}
      onTouchStart={handleDragStart}
      onTouchMove={handleDragMove}
      onTouchEnd={handleDragEnd}
      style={cursorStyle}
    >
      {/* Top Toolbar */}
      <div className="flex justify-end gap-1.5 sm:gap-3 z-10 toolbar-button-container flex-wrap">
        <button 
          onClick={onDownload}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          title="Download File"
        >
          <i className="fa-solid fa-download text-lg"></i>
        </button>
        <button 
          onClick={onClose}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          title="Close"
        >
          <i className="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      {/* Main Content Area */}
      <div 
        id="media-viewer-content-container"
        className="flex-1 flex items-center justify-center relative overflow-hidden"
      >
        {/* Navigation buttons (hidden when zoomed in) */}
        {mediaList.length > 1 && scale === 1 && (
          <>
            <button 
              onClick={(e) => { e.stopPropagation(); onPrev(); }}
              className="absolute left-2 md:left-6 w-12 h-12 rounded-full flex items-center justify-center bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-all z-10 border border-white/10 cursor-pointer"
            >
              <i className="fa-solid fa-chevron-left text-lg"></i>
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onNext(); }}
              className="absolute right-2 md:right-6 w-12 h-12 rounded-full flex items-center justify-center bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-all z-10 border border-white/10 cursor-pointer"
            >
              <i className="fa-solid fa-chevron-right text-lg"></i>
            </button>
          </>
        )}

        {/* Media elements wrapper with scale/panning transforms */}
        {currentMsg && (
          <div 
            key={activeIndex}
            className={`max-w-[90%] max-h-[80vh] flex items-center justify-center relative ${animationClass}`}
            onMouseDown={handleDragStart}
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
          >
            {isVideo ? (
              <video 
                ref={videoRef}
                src={currentMsg.url} 
                controls 
                autoPlay
                className="max-w-full max-h-[85vh] object-contain shadow-2xl rounded"
              />
            ) : (
              <img 
                src={currentMsg.url} 
                alt={displayName} 
                className="max-w-full max-h-[85vh] object-contain shadow-2xl rounded select-none pointer-events-none"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                  transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                  transformOrigin: 'center center'
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer Caption */}
      <div className="text-center text-white/60 text-xs font-mono py-2 truncate max-w-lg mx-auto z-10 select-none">
        {displayName}
      </div>
    </div>
  );
}
