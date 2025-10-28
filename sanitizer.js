// paper-trader/sanitizer.js
// FIXED: Comprehensive XSS protection for user-generated content
// Protects against script injection, event handlers, and malicious HTML

/**
 * Sanitizer utility for protecting against XSS attacks
 * Handles text content, HTML attributes, and URLs
 */
export class Sanitizer {
  constructor() {
    // Dangerous patterns to detect and remove
    this.dangerousPatterns = {
      // Script tags (all variations)
      scriptTags: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      
      // Event handlers (onclick, onerror, onload, etc.)
      eventHandlers: /on\w+\s*=\s*["'][^"']*["']/gi,
      
      // JavaScript protocols
      jsProtocol: /javascript:/gi,
      
      // Data URLs (can contain embedded scripts)
      dataUrl: /data:text\/html/gi,
      
      // Style with expressions (IE specific but dangerous)
      styleExpression: /style\s*=\s*["'][^"']*expression\s*\([^"']*\)["']/gi,
      
      // Iframe tags
      iframeTags: /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
      
      // Object/embed tags
      objectTags: /<(object|embed)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi,
      
      // Meta refresh redirects
      metaRefresh: /<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi,
      
      // Base tag (can change relative URLs)
      baseTags: /<base\b[^<]*>/gi,
      
      // Form tags (can be used for phishing)
      formTags: /<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi
    };

    // Allowed HTML tags for rich text (if needed)
    this.allowedTags = new Set([
      'b', 'i', 'u', 'strong', 'em', 'br', 'p', 'span', 'div'
    ]);

    // Safe URL protocols
    this.safeProtocols = new Set([
      'http:', 'https:', 'mailto:', 'tel:', 'ftp:'
    ]);
  }

  /**
   * Sanitize plain text - removes all HTML and dangerous content
   * Use for: Trade notes, tags, symbol names, etc.
   */
  sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    
    // First pass: Remove all dangerous patterns
    let cleaned = this._removeDangerousPatterns(text);
    
    // Second pass: Encode HTML entities
    cleaned = this._encodeHtmlEntities(cleaned);
    
    // Third pass: Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // Fourth pass: Limit length to prevent DoS
    cleaned = cleaned.substring(0, 10000);
    
    return cleaned;
  }

  /**
   * Sanitize HTML content - removes dangerous tags but preserves safe formatting
   * Use for: Rich text notes (if implemented)
   */
  sanitizeHtml(html) {
    if (!html || typeof html !== 'string') return '';
    
    // Remove dangerous patterns first
    let cleaned = this._removeDangerousPatterns(html);
    
    // Create temporary element for parsing
    const temp = document.createElement('div');
    temp.textContent = cleaned; // This safely encodes everything
    
    // If you want to allow some HTML tags:
    // cleaned = this._allowSafeTags(cleaned);
    
    return temp.innerHTML;
  }

  /**
   * Sanitize URL - ensures URL is safe to use
   * Use for: External links, image sources
   */
  sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    
    // Trim and normalize
    url = url.trim().toLowerCase();
    
    // Check for dangerous protocols
    if (this.dangerousPatterns.jsProtocol.test(url)) {
      console.warn('[Sanitizer] Blocked javascript: protocol in URL');
      return '';
    }
    
    if (this.dangerousPatterns.dataUrl.test(url)) {
      console.warn('[Sanitizer] Blocked data: URL');
      return '';
    }
    
    // Verify protocol is safe
    try {
      const parsed = new URL(url, window.location.origin);
      if (!this.safeProtocols.has(parsed.protocol)) {
        console.warn('[Sanitizer] Blocked unsafe protocol:', parsed.protocol);
        return '';
      }
      return parsed.href;
    } catch (e) {
      // Not a valid URL, treat as relative or invalid
      console.warn('[Sanitizer] Invalid URL:', url);
      return '';
    }
  }

  /**
   * Sanitize attribute value - for HTML attributes
   * Use for: data attributes, class names, IDs
   */
  sanitizeAttribute(value) {
    if (!value || typeof value !== 'string') return '';
    
    // Remove quotes and dangerous characters
    let cleaned = value
      .replace(/["'`]/g, '')
      .replace(/[<>]/g, '')
      .replace(/javascript:/gi, '')
      .trim();
    
    return cleaned.substring(0, 1000);
  }

  /**
   * Sanitize array of strings (e.g., tags)
   */
  sanitizeArray(arr) {
    if (!Array.isArray(arr)) return [];
    
    return arr
      .map(item => this.sanitizeText(String(item)))
      .filter(item => item.length > 0)
      .slice(0, 100); // Limit array size
  }

  /**
   * Sanitize object with multiple fields
   * Use for: Trade data, user input objects
   */
  sanitizeObject(obj, schema) {
    if (!obj || typeof obj !== 'object') return {};
    
    const sanitized = {};
    
    for (const [key, config] of Object.entries(schema)) {
      const value = obj[key];
      
      switch (config.type) {
        case 'text':
          sanitized[key] = this.sanitizeText(value);
          break;
        case 'html':
          sanitized[key] = this.sanitizeHtml(value);
          break;
        case 'url':
          sanitized[key] = this.sanitizeUrl(value);
          break;
        case 'array':
          sanitized[key] = this.sanitizeArray(value);
          break;
        case 'number':
          sanitized[key] = this._sanitizeNumber(value);
          break;
        case 'boolean':
          sanitized[key] = Boolean(value);
          break;
        default:
          sanitized[key] = this.sanitizeText(String(value));
      }
    }
    
    return sanitized;
  }

  /**
   * Remove all dangerous patterns from text
   */
  _removeDangerousPatterns(text) {
    let cleaned = text;
    
    // Apply all pattern removals
    for (const pattern of Object.values(this.dangerousPatterns)) {
      cleaned = cleaned.replace(pattern, '');
    }
    
    return cleaned;
  }

  /**
   * Encode HTML entities to prevent XSS
   */
  _encodeHtmlEntities(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Decode HTML entities (use with caution)
   */
  _decodeHtmlEntities(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  /**
   * Allow only safe HTML tags (if rich text is needed)
   */
  _allowSafeTags(html) {
    // Parse and rebuild with only allowed tags
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    this._cleanNode(temp);
    
    return temp.innerHTML;
  }

  /**
   * Recursively clean DOM nodes
   */
  _cleanNode(node) {
    // Remove text nodes and check element nodes
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toLowerCase();
      
      // Remove if not allowed
      if (!this.allowedTags.has(tagName)) {
        node.parentNode?.removeChild(node);
        return;
      }
      
      // Remove all attributes except safe ones
      const allowedAttrs = ['class', 'id'];
      const attrs = Array.from(node.attributes);
      
      for (const attr of attrs) {
        if (!allowedAttrs.includes(attr.name.toLowerCase())) {
          node.removeAttribute(attr.name);
        }
      }
    }
    
    // Recursively clean children
    const children = Array.from(node.childNodes);
    for (const child of children) {
      this._cleanNode(child);
    }
  }

  /**
   * Sanitize number input
   */
  _sanitizeNumber(value) {
    const num = parseFloat(value);
    return isNaN(num) || !isFinite(num) ? 0 : num;
  }

  /**
   * Create safe HTML string for display
   */
  createSafeHtml(strings, ...values) {
    let result = strings[0];
    
    for (let i = 0; i < values.length; i++) {
      result += this.sanitizeText(String(values[i]));
      result += strings[i + 1];
    }
    
    return result;
  }

  /**
   * Validate if content is safe (returns boolean + reasons)
   */
  validate(content) {
    const issues = [];
    
    if (!content || typeof content !== 'string') {
      return { safe: true, issues: [] };
    }
    
    // Check each dangerous pattern
    for (const [name, pattern] of Object.entries(this.dangerousPatterns)) {
      if (pattern.test(content)) {
        issues.push(`Detected: ${name}`);
      }
    }
    
    return {
      safe: issues.length === 0,
      issues,
      sanitized: this.sanitizeText(content)
    };
  }

  /**
   * Get statistics about sanitization operations
   */
  getStats() {
    return {
      version: '1.0.0',
      patterns: Object.keys(this.dangerousPatterns).length,
      allowedTags: Array.from(this.allowedTags),
      safeProtocols: Array.from(this.safeProtocols)
    };
  }
}

// Create singleton instance
export const sanitizer = new Sanitizer();

// Convenience functions
export function sanitizeText(text) {
  return sanitizer.sanitizeText(text);
}

export function sanitizeHtml(html) {
  return sanitizer.sanitizeHtml(html);
}

export function sanitizeUrl(url) {
  return sanitizer.sanitizeUrl(url);
}

export function sanitizeArray(arr) {
  return sanitizer.sanitizeArray(arr);
}

export function sanitizeObject(obj, schema) {
  return sanitizer.sanitizeObject(obj, schema);
}

export function validateContent(content) {
  return sanitizer.validate(content);
}

// Trade data schema for sanitization
export const TRADE_SCHEMA = {
  symbol: { type: 'text' },
  note: { type: 'text' },
  tags: { type: 'array' },
  side: { type: 'text' },
  quantity: { type: 'number' },
  price: { type: 'number' },
  leverage: { type: 'number' }
};

// Example usage:
// import { sanitizeText, sanitizeObject, TRADE_SCHEMA } from './sanitizer.js';
// 
// const userInput = sanitizeText(document.getElementById('note').value);
// const trade = sanitizeObject(rawTradeData, TRADE_SCHEMA);