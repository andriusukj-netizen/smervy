// drag-drop.js - Improved mobile: adds swipe/long-tap for drag start
export function enableDragDrop(grid) {
  if (!grid) return null;

  let draggedEl = null;
  let placeholder = null;
  let startX, startY, offsetX, offsetY;
  let currentX = 0, currentY = 0;
  let targetX = 0, targetY = 0;
  let prevX = 0, prevY = 0;
  let rafId = null;
  let isDestroying = false;
  let longTapTimeout = null;
  let isTouchDragging = false;

  // Track all event listeners for cleanup
  const eventListeners = [];
  const cardHandlers = new WeakMap(); // Track handlers per card

  function addEventListenerWithTracking(element, event, handler, options) {
    if (isDestroying || !element) return;
    try {
      element.addEventListener(event, handler, options);
      eventListeners.push({ element, event, handler, options });
    } catch (error) {
      console.warn('[DragDrop] Error adding event listener:', error);
    }
  }

  function removeEventListenerWithTracking(element, event, handler, options) {
    try {
      element?.removeEventListener(event, handler, options);
      const index = eventListeners.findIndex(l =>
        l.element === element && l.event === event && l.handler === handler
      );
      if (index !== -1) {
        eventListeners.splice(index, 1);
      }
    } catch (error) {
      console.warn('[DragDrop] Error removing event listener:', error);
    }
  }

  function setCardDraggable(card) {
    if (isDestroying || !card) return;

    const handle = card.querySelector('.drag-handle');
    if (!handle) return;

    handle.style.cursor = "grab";

    // Create handlers for this specific card
    const handlers = {
      mousedown: null,
      touchstart: null,
      mousemove: null,
      touchmove: null,
      mouseup: null,
      touchend: null
    };

    function startDrag(e) {
      if (isDestroying) return;

      // Only allow touch drag if we've flagged it as long-tap or swipe
      if (e.type === "touchstart" && !isTouchDragging) return;

      e.preventDefault();

      draggedEl = card;

      try {
        const rect = card.getBoundingClientRect();

        if (e.touches) {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
        } else {
          startX = e.clientX;
          startY = e.clientY;
        }
        offsetX = startX - rect.left;
        offsetY = startY - rect.top;

        // Create placeholder
        placeholder = document.createElement('div');
        placeholder.className = 'chart-card placeholder';
        placeholder.style.height = `${rect.height}px`;
        if (grid) {
          grid.insertBefore(placeholder, card);
        }

        // Float dragged element
        card.style.position = 'absolute';
        card.style.top = `${rect.top + window.scrollY}px`;
        card.style.left = `${rect.left + window.scrollX}px`;
        card.style.width = `${rect.width}px`;
        card.style.height = `${rect.height}px`;
        card.style.pointerEvents = 'none';
        card.style.zIndex = '1000';
        if (card.classList) card.classList.add('dragging');

        currentX = rect.left + window.scrollX;
        currentY = rect.top + window.scrollY;
        targetX = currentX;
        targetY = currentY;
        prevX = currentX;
        prevY = currentY;

        animateDrag();

        // Add global move and end listeners
        addEventListenerWithTracking(document, 'mousemove', handlers.mousemove);
        addEventListenerWithTracking(document, 'touchmove', handlers.touchmove, { passive: false });
        addEventListenerWithTracking(document, 'mouseup', handlers.mouseup);
        addEventListenerWithTracking(document, 'touchend', handlers.touchend);

        // Reset touch drag flag
        isTouchDragging = false;
      } catch (error) {
        console.warn('[DragDrop] Error starting drag:', error);
        endDrag();
      }
    }

    function onDrag(e) {
      if (!draggedEl || isDestroying) return;

      try {
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        const y = e.touches ? e.touches[0].clientY : e.clientY;

        targetX = x - offsetX;
        targetY = y - offsetY;

        const afterElement = getDragAfterElement(grid, y);
        if (afterElement && placeholder) {
          grid.insertBefore(placeholder, afterElement);
        } else if (placeholder) {
          grid.appendChild(placeholder);
        }
      } catch (error) {
        console.warn('[DragDrop] Error during drag:', error);
      }
    }

    function animateDrag() {
      if (!draggedEl || isDestroying) return;

      try {
        // Smooth follow with bounds checking
        currentX += (targetX - currentX) * 0.25;
        currentY += (targetY - currentY) * 0.25;

        // Velocity calculation
        const dx = currentX - prevX;
        const dy = currentY - prevY;
        prevX = currentX;
        prevY = currentY;

        // Squash & stretch mapping with safety bounds
        const maxSquash = 0.07;
        const scaleX = 1 + Math.min(Math.max(dx / 50, -maxSquash), maxSquash);
        const scaleY = 1 + Math.min(Math.max(dy / 50, -maxSquash), maxSquash);

        // Safe transform application
        if (draggedEl && draggedEl.style) {
          const translateX = currentX - draggedEl.offsetLeft;
          const translateY = currentY - draggedEl.offsetTop;
          draggedEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
        }

        rafId = requestAnimationFrame(animateDrag);
      } catch (error) {
        console.warn('[DragDrop] Error in animation frame:', error);
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      }
    }

    function endDrag() {
      if (isDestroying) return;

      try {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        if (draggedEl) {
          if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(draggedEl, placeholder);
          }

          // Reset styles safely
          if (draggedEl.style) {
            draggedEl.style.position = '';
            draggedEl.style.top = '';
            draggedEl.style.left = '';
            draggedEl.style.width = '';
            draggedEl.style.height = '';
            draggedEl.style.pointerEvents = '';
            draggedEl.style.transform = '';
            draggedEl.style.zIndex = '';
          }

          if (draggedEl.classList) {
            draggedEl.classList.remove('dragging');
            draggedEl.classList.add('dropped');
            setTimeout(() => {
              if (draggedEl && draggedEl.classList && !isDestroying) {
                draggedEl.classList.remove('dropped');
              }
            }, 400);
          }
        }

        if (placeholder) {
          placeholder.remove();
          placeholder = null;
        }

        draggedEl = null;

        saveOrder();

        // Remove global listeners
        removeEventListenerWithTracking(document, 'mousemove', handlers.mousemove);
        removeEventListenerWithTracking(document, 'touchmove', handlers.touchmove);
        removeEventListenerWithTracking(document, 'mouseup', handlers.mouseup);
        removeEventListenerWithTracking(document, 'touchend', handlers.touchend);

        // Reset touch drag flag
        isTouchDragging = false;
      } catch (error) {
        console.warn('[DragDrop] Error ending drag:', error);
      }
    }

    // Long-tap and swipe logic for drag handle (mobile)
    function handleTouchStart(e) {
      if (isDestroying) return;
      if (e.touches && e.touches.length === 1) {
        isTouchDragging = false;
        // Start long-tap timer (400ms)
        longTapTimeout = setTimeout(() => {
          isTouchDragging = true;
          startDrag(e);
        }, 400);

        // Also allow drag for quick swipe gesture
        let startTouch = e.touches[0];
        let hasMoved = false;
        const moveListener = (moveEvent) => {
          if (!startTouch) return;
          let moveTouch = moveEvent.touches[0];
          if (Math.abs(moveTouch.clientY - startTouch.clientY) > 10 || Math.abs(moveTouch.clientX - startTouch.clientX) > 10) {
            hasMoved = true;
            if (!isTouchDragging && longTapTimeout) {
              clearTimeout(longTapTimeout);
              longTapTimeout = null;
              isTouchDragging = true;
              startDrag(moveEvent);
            }
          }
        };
        handle.addEventListener('touchmove', moveListener, { passive: false });
        const cleanupTouch = () => {
          handle.removeEventListener('touchmove', moveListener);
          handle.removeEventListener('touchend', cleanupTouch);
          handle.removeEventListener('touchcancel', cleanupTouch);
          if (longTapTimeout) {
            clearTimeout(longTapTimeout);
            longTapTimeout = null;
          }
          isTouchDragging = false;
        };
        handle.addEventListener('touchend', cleanupTouch);
        handle.addEventListener('touchcancel', cleanupTouch);
      }
    }

    function handleTouchEnd() {
      if (longTapTimeout) {
        clearTimeout(longTapTimeout);
        longTapTimeout = null;
      }
      isTouchDragging = false;
    }

    // Create bound handlers
    handlers.mousemove = onDrag;
    handlers.touchmove = onDrag;
    handlers.mouseup = endDrag;
    handlers.touchend = endDrag;

    // Add start event listeners to handle
    addEventListenerWithTracking(handle, 'mousedown', startDrag);
    addEventListenerWithTracking(handle, 'touchstart', handleTouchStart, { passive: false });
    addEventListenerWithTracking(handle, 'touchend', handleTouchEnd);

    // Store handlers for this card for cleanup
    cardHandlers.set(card, { handle, startDrag, handlers });
  }

  function getDragAfterElement(container, y) {
    if (!container || isDestroying) return null;

    try {
      const elements = [...container.querySelectorAll('.chart-card:not(.dragging):not(.placeholder)')];

      for (const child of elements) {
        const rect = child.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        if (y < midpoint) {
          return child; // insert before
        } else if (y >= midpoint && y <= rect.bottom) {
          return child.nextSibling; // insert after
        }
      }

      return null; // append at the end
    } catch (error) {
      console.warn('[DragDrop] Error in getDragAfterElement:', error);
      return null;
    }
  }

  function saveOrder() {
    if (!grid || isDestroying) return;

    try {
      const order = Array.from(grid.querySelectorAll('.chart-card'))
        .map(el => el.dataset.symbol)
        .filter(Boolean);
      localStorage.setItem('chartOrder', JSON.stringify(order));
    } catch (err) {
      console.warn('[DragDrop] Failed to save order:', err);
    }
  }

  function restoreOrder() {
    if (!grid || isDestroying) return;

    try {
      const raw = localStorage.getItem('chartOrder');
      if (!raw) return;

      const order = JSON.parse(raw);
      if (!Array.isArray(order)) return;

      const nodeMap = {};
      Array.from(grid.querySelectorAll('.chart-card')).forEach(n => {
        if (n.dataset?.symbol) {
          nodeMap[n.dataset.symbol.toLowerCase()] = n;
        }
      });

      order.forEach(sym => {
        const node = nodeMap[sym?.toLowerCase()];
        if (node && !isDestroying) {
          grid.appendChild(node);
        }
      });
    } catch (err) {
      console.warn('[DragDrop] Failed to restore chart order:', err);
    }
  }

  // Monitor removals to cleanup per-card handlers
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      (m.removedNodes || []).forEach(node => {
        if (!node || !node.classList) return;
        if (node.classList.contains('chart-card')) {
          // cleanup handlers for this card if any
          try {
            const info = cardHandlers.get(node);
            if (info && info.handlers) {
              const { handle, handlers } = info;
              if (handlers) {
                removeEventListenerWithTracking(handle, 'mousedown', handlers.mousedown);
                removeEventListenerWithTracking(handle, 'touchstart', handlers.touchstart);
                removeEventListenerWithTracking(handle, 'touchend', handlers.touchend);
                // remove global ones if present
                removeEventListenerWithTracking(document, 'mousemove', handlers.mousemove);
                removeEventListenerWithTracking(document, 'touchmove', handlers.touchmove);
                removeEventListenerWithTracking(document, 'mouseup', handlers.mouseup);
                removeEventListenerWithTracking(document, 'touchend', handlers.touchend);
              }
            }
            cardHandlers.delete(node);
          } catch (err) {}
        }
      });
    }
  });
  try { mo.observe(grid, { childList: true, subtree: false }); } catch (e) {}

  // Initialize drag and drop
  try {
    Array.from(grid.querySelectorAll('.chart-card')).forEach(setCardDraggable);
    restoreOrder();
  } catch (error) {
    console.error('[DragDrop] Error during initialization:', error);
  }

  // Return cleanup function
  return function cleanup() {
    console.log('[DragDrop] Performing cleanup...');
    isDestroying = true;

    try {
      // Cancel any ongoing animation
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      // Clean up drag state
      if (draggedEl) {
        try {
          if (draggedEl.style) {
            draggedEl.style.position = '';
            draggedEl.style.top = '';
            draggedEl.style.left = '';
            draggedEl.style.width = '';
            draggedEl.style.height = '';
            draggedEl.style.pointerEvents = '';
            draggedEl.style.transform = '';
            draggedEl.style.zIndex = '';
          }
          if (draggedEl.classList) {
            draggedEl.classList.remove('dragging');
          }
        } catch (error) {
          console.warn('[DragDrop] Error cleaning dragged element:', error);
        }
      }

      // Remove placeholder
      if (placeholder) {
        try {
          placeholder.remove();
        } catch (error) {
          console.warn('[DragDrop] Error removing placeholder:', error);
        }
        placeholder = null;
      }

      // Clean up all event listeners
      eventListeners.forEach(({ element, event, handler, options }) => {
        try {
          element?.removeEventListener(event, handler, options);
        } catch (error) {
          console.warn('[DragDrop] Error removing event listener during cleanup:', error);
        }
      });
      eventListeners.length = 0;

      // Disconnect mutation observer
      try { mo.disconnect(); } catch (e) {}

      // Clean up card-specific handlers
      cardHandlers.clear();

      // Reset state
      draggedEl = null;
      isTouchDragging = false;
      if (longTapTimeout) {
        clearTimeout(longTapTimeout);
        longTapTimeout = null;
      }

      console.log('[DragDrop] Cleanup completed');
    } catch (error) {
      console.error('[DragDrop] Error during cleanup:', error);
    }
  };
}