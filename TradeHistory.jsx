// COMPREHENSIVE XSS FIXES FOR REACT COMPONENTS
// TradeHistory.jsx and OrderForm.jsx

// ============================================================================
// FILE 1: TradeHistory.jsx - COMPLETE FIXED VERSION
// ============================================================================

import React, { useState } from 'react';

// ✅ FIX: Sanitization helper for React
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

// ✅ FIX: Sanitize tag array
function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  
  return tags
    .map(tag => sanitizeText(String(tag)))
    .filter(tag => tag.length > 0)
    .slice(0, 10); // Limit to 10 tags
}

export default function TradeHistory({ trades, onAnnotate }) {
  const [filterTag, setFilterTag] = useState('');
  const [editId, setEditId] = useState(null);
  const [editTags, setEditTags] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const [editError, setEditError] = useState('');

  function startEdit(trade) {
    setEditId(trade.id);
    // ✅ FIX: Sanitize values when loading into form
    setEditTags(sanitizeTags(trade.tags).join(', '));
    setEditNote(sanitizeText(trade.note || ''));
    setEditSuccess('');
    setEditError('');
  }

  async function saveEdit() {
    try {
      // ✅ FIX: Sanitize before saving
      const rawTags = editTags.split(',').map(t => t.trim()).filter(Boolean);
      const sanitizedTags = sanitizeTags(rawTags);
      const sanitizedNote = sanitizeText(editNote);
      
      // Validate limits
      if (sanitizedTags.length > 10) {
        setEditError('Maximum 10 tags allowed');
        setEditSuccess('');
        return;
      }
      
      if (sanitizedNote.length > 1000) {
        setEditError('Note too long (max 1000 characters)');
        setEditSuccess('');
        return;
      }
      
      await onAnnotate(editId, sanitizedTags, sanitizedNote);
      setEditSuccess('✅ Saved!');
      setEditError('');
      setTimeout(() => setEditSuccess(''), 1500);
    } catch (err) {
      // ✅ FIX: Sanitize error message
      setEditError('Failed to save: ' + sanitizeText(err.message || 'Unknown error'));
      setEditSuccess('');
    }
    setEditId(null);
    setEditTags('');
    setEditNote('');
  }

  let filteredTrades = trades;
  if (filterTag) {
    // ✅ FIX: Sanitize filter input
    const safeFilterTag = sanitizeText(filterTag);
    filteredTrades = trades.filter(trade => 
      sanitizeTags(trade.tags).some(tag => 
        tag.toLowerCase().includes(safeFilterTag.toLowerCase())
      )
    );
  }

  return (
    <div>
      <label>
        Filter by tag:
        <input 
          value={filterTag} 
          onChange={e => setFilterTag(e.target.value)} 
          placeholder="Type tag to filter"
          maxLength={50}
        />
      </label>
      
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Price</th>
            <th>P&L</th>
            <th>Type</th>
            <th>Leverage</th>
            <th>Tags</th>
            <th>Note</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredTrades.map(trade => {
            // ✅ FIX: Sanitize all displayed values
            const safeTags = sanitizeTags(trade.tags);
            const safeNote = sanitizeText(trade.note || '');
            const safeSymbol = sanitizeText(trade.symbol);
            
            return (
              <tr key={trade.id}>
                <td>{trade.id}</td>
                {/* ✅ FIX: React escapes these automatically, but we sanitize for defense-in-depth */}
                <td>{safeSymbol}</td>
                <td style={{ color: trade.side === 'buy' ? '#0ecb81' : '#f6465d' }}>
                  {trade.side}
                </td>
                <td>{trade.quantity}</td>
                <td>{trade.price}</td>
                <td style={{
                  color: typeof trade.pnl === 'number'
                    ? trade.pnl >= 0 ? '#0ecb81' : '#f6465d'
                    : '#8a93a1',
                  fontWeight: typeof trade.pnl === 'number' ? 700 : 400
                }}>
                  {typeof trade.pnl === 'number' 
                    ? (trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2) 
                    : ''}
                </td>
                <td>{trade.tradeType || 'spot'}</td>
                <td>{trade.leverage || 1}</td>
                {/* ✅ FIX: Display sanitized tags */}
                <td>{safeTags.join(', ') || <span style={{color: '#8a93a1'}}>none</span>}</td>
                {/* ✅ FIX: Display sanitized note */}
                <td style={{maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                  {safeNote || <span style={{color: '#8a93a1'}}>none</span>}
                </td>
                <td>
                  <button onClick={() => startEdit(trade)}>Edit</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      
      {editId && (
        <div style={{ 
          marginTop: 16, 
          padding: 12, 
          border: '1px solid #eee', 
          borderRadius: 8, 
          background: '#16181b' 
        }}>
          <h4>Edit Trade Annotation</h4>
          
          <label>
            Tags (comma separated):
            <input 
              value={editTags} 
              onChange={e => setEditTags(e.target.value)}
              maxLength={200}
              placeholder="max 10 tags, 50 chars each"
            />
            <div style={{ fontSize: '11px', color: '#8a93a1', marginTop: '4px' }}>
              {editTags.split(',').filter(t => t.trim()).length}/10 tags
            </div>
          </label>
          
          <label>
            Note:
            <textarea 
              value={editNote} 
              onChange={e => setEditNote(e.target.value)}
              maxLength={1000}
              placeholder="Trade notes (max 1000 characters)"
              rows={4}
            />
            <div style={{ fontSize: '11px', color: '#8a93a1', marginTop: '4px' }}>
              {editNote.length}/1000 characters
            </div>
          </label>
          
          <div style={{ marginTop: 8 }}>
            <button onClick={saveEdit}>Save</button>
            <button 
              onClick={() => {
                setEditId(null);
                setEditTags('');
                setEditNote('');
                setEditError('');
                setEditSuccess('');
              }} 
              style={{ marginLeft: 10 }}
            >
              Cancel
            </button>
          </div>
          
          {editSuccess && (
            <span style={{ color: '#16a34a', marginLeft: 12, display: 'block', marginTop: 8 }}>
              {editSuccess}
            </span>
          )}
          
          {editError && (
            <span style={{ color: '#dc2626', marginLeft: 12, display: 'block', marginTop: 8 }}>
              ⚠️ {editError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FILE 2: OrderForm.jsx - ENHANCED WITH XSS PROTECTION
// ============================================================================

import React, { useState, useEffect } from 'react';

// ✅ FIX: Add sanitization helper
function sanitizeInput(value) {
  if (!value || typeof value !== 'string') return '';
  
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

export default function OrderForm({ onSubmit, maxLeverage = 10 }) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState('buy');
  const [quantity, setQuantity] = useState(1);
  const [type, setType] = useState('MARKET');
  const [price, setPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [trailingStop, setTrailingStop] = useState('');
  const [tradeType, setTradeType] = useState('spot');
  const [leverage, setLeverage] = useState(1);
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  // Real-time leverage validation
  useEffect(() => {
    if (tradeType === 'margin') {
      const lev = Number(leverage);
      if (isNaN(lev)) {
        setWarning('Leverage must be a number');
      } else if (lev < 1) {
        setWarning('Leverage cannot be less than 1x');
      } else if (lev > maxLeverage) {
        setWarning(`Leverage cannot exceed ${maxLeverage}x`);
      } else if (lev > 5) {
        setWarning(`⚠️ High leverage (${lev}x) increases risk significantly`);
      } else {
        setWarning('');
      }
    } else {
      setWarning('');
    }
  }, [leverage, tradeType, maxLeverage]);

  // ✅ FIX: Validate leverage input
  function validateLeverage(value) {
    const lev = Number(value);
    
    if (isNaN(lev) || !isFinite(lev)) {
      return { valid: false, error: 'Leverage must be a valid number' };
    }
    
    if (lev < 1) {
      return { valid: false, error: 'Leverage must be at least 1x' };
    }
    
    if (lev > maxLeverage) {
      return { valid: false, error: `Leverage cannot exceed ${maxLeverage}x (maximum allowed)` };
    }
    
    const decimalPlaces = (value.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      return { valid: false, error: 'Leverage can have at most 2 decimal places (e.g., 2.50)' };
    }
    
    if (lev > 5) {
      return { 
        valid: true, 
        warning: `High leverage (${lev}x) amplifies both gains and losses` 
      };
    }
    
    return { valid: true };
  }

  // ✅ FIX: Enhanced symbol validation with XSS protection
  function validateSymbol(sym) {
    if (!sym || sym.trim().length === 0) {
      return { valid: false, error: 'Symbol is required' };
    }
    
    // ✅ FIX: Sanitize input first
    const cleaned = sanitizeInput(sym);
    const trimmed = cleaned.trim().toUpperCase();
    
    // Check for valid format
    if (!/^[A-Z0-9]{2,20}$/.test(trimmed)) {
      return { 
        valid: false, 
        error: 'Symbol must be 2-20 alphanumeric characters (e.g., BTCUSDT)' 
      };
    }
    
    return { valid: true, symbol: trimmed };
  }

  // Validate stop loss and take profit
  function validateStopLossTakeProfit(orderSide, entryPrice, sl, tp) {
    const errors = [];
    
    if (sl && tp) {
      if (orderSide === 'buy') {
        if (sl >= entryPrice) {
          errors.push('Stop loss must be below entry price for buy orders');
        }
        if (tp <= entryPrice) {
          errors.push('Take profit must be above entry price for buy orders');
        }
        if (sl >= tp) {
          errors.push('Stop loss must be below take profit');
        }
      } else if (orderSide === 'sell') {
        if (sl <= entryPrice) {
          errors.push('Stop loss must be above entry price for sell orders');
        }
        if (tp >= entryPrice) {
          errors.push('Take profit must be below entry price for sell orders');
        }
        if (sl <= tp) {
          errors.push('Stop loss must be above take profit');
        }
      }
    }
    
    return errors;
  }

  // Calculate risk/reward ratio
  function calculateRiskReward(entryPrice, sl, tp) {
    if (!entryPrice || !sl || !tp) return null;
    
    const risk = Math.abs(entryPrice - sl);
    const reward = Math.abs(tp - entryPrice);
    
    if (risk === 0) return null;
    
    return {
      ratio: (reward / risk).toFixed(2),
      risk: risk.toFixed(2),
      reward: reward.toFixed(2)
    };
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setWarning('');

    // ✅ FIX: Validate and sanitize symbol
    const symbolValidation = validateSymbol(symbol);
    if (!symbolValidation.valid) {
      setError(symbolValidation.error);
      return;
    }

    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError('Quantity must be positive');
      return;
    }

    if (qty > 1000000) {
      setError('Quantity is unrealistically high');
      return;
    }

    const priceValue = Number(price);
    if (type !== 'MARKET' && (!priceValue || priceValue <= 0)) {
      setError('Price is required for non-market orders');
      return;
    }

    if (tradeType === 'margin') {
      const leverageValidation = validateLeverage(leverage);
      if (!leverageValidation.valid) {
        setError(leverageValidation.error);
        return;
      }
      
      if (leverageValidation.warning) {
        setWarning(leverageValidation.warning);
      }
    }

    const slValue = stopLoss ? Number(stopLoss) : null;
    const tpValue = takeProfit ? Number(takeProfit) : null;
    const entryPrice = type === 'MARKET' ? 0 : priceValue;

    if (entryPrice > 0 && (slValue || tpValue)) {
      const slTpErrors = validateStopLossTakeProfit(side, entryPrice, slValue, tpValue);
      if (slTpErrors.length > 0) {
        setError(slTpErrors.join('. '));
        return;
      }
    }

    let rrRatio = null;
    if (entryPrice > 0 && slValue && tpValue) {
      rrRatio = calculateRiskReward(entryPrice, slValue, tpValue);
      if (rrRatio && Number(rrRatio.ratio) < 1) {
        setWarning(`⚠️ Risk/Reward ratio is ${rrRatio.ratio}:1 (risk is higher than reward)`);
      }
    }

    // ✅ FIX: Sanitize tags and note
    const rawTags = tags.split(',').map(t => t.trim()).filter(Boolean);
    const sanitizedTags = rawTags
      .map(tag => sanitizeInput(tag))
      .filter(tag => tag.length > 0)
      .slice(0, 10);
    
    if (rawTags.length > 10) {
      setError('Maximum 10 tags allowed');
      return;
    }

    // ✅ FIX: Sanitize note
    const sanitizedNote = sanitizeInput(note).substring(0, 1000);
    
    if (note.length > 1000) {
      setError('Note is too long (max 1000 characters)');
      return;
    }

    const sanitizedLeverage = Math.max(1, Math.min(Number(leverage), maxLeverage));

    const order = {
      symbol: symbolValidation.symbol,
      side,
      quantity: qty,
      type,
      price: type !== 'MARKET' ? priceValue : null,
      stopLoss: slValue,
      takeProfit: tpValue,
      trailingStop: trailingStop || null,
      tradeType,
      leverage: tradeType === 'margin' ? sanitizedLeverage : 1,
      tags: sanitizedTags,
      note: sanitizedNote
    };

    onSubmit(order);

    // Reset form
    setSymbol('');
    setQuantity(1);
    setType('MARKET');
    setPrice('');
    setStopLoss('');
    setTakeProfit('');
    setTrailingStop('');
    setTradeType('spot');
    setLeverage(1);
    setTags('');
    setNote('');
    setError('');
    setWarning('');
  }

  function handleLeverageChange(e) {
    const value = e.target.value;
    if (value === '') {
      setLeverage('');
      return;
    }
    const numValue = Number(value);
    if (!isNaN(numValue)) {
      setLeverage(value);
    }
  }

  function handleLeverageBlur() {
    const numValue = Number(leverage);
    if (isNaN(numValue) || numValue < 1) {
      setLeverage(1);
    } else if (numValue > maxLeverage) {
      setLeverage(maxLeverage);
    } else {
      setLeverage(Number(numValue.toFixed(2)));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{ 
          color: '#dc2626', 
          fontWeight: 700, 
          padding: '12px', 
          background: 'rgba(220, 38, 38, 0.1)',
          borderRadius: '8px',
          border: '1px solid rgba(220, 38, 38, 0.3)'
        }}>
          {/* ✅ FIX: React auto-escapes, but we sanitize for defense-in-depth */}
          ⚠️ {sanitizeInput(error)}
        </div>
      )}
      
      {warning && !error && (
        <div style={{ 
          color: '#f59e0b', 
          fontWeight: 600, 
          padding: '12px', 
          background: 'rgba(245, 158, 11, 0.1)',
          borderRadius: '8px',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          fontSize: '13px'
        }}>
          {sanitizeInput(warning)}
        </div>
      )}

      <label>
        Symbol:
        <input 
          value={symbol} 
          onChange={e => setSymbol(e.target.value)} 
          placeholder="BTCUSDT"
          maxLength={20}
        />
      </label>

      <label>
        Side:
        <select value={side} onChange={e => setSide(e.target.value)}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
      </label>

      <label>
        Quantity:
        <input 
          type="number" 
          value={quantity} 
          min={0.001} 
          step={0.001} 
          onChange={e => setQuantity(e.target.value)} 
        />
      </label>

      <label>
        Order Type:
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="MARKET">Market</option>
          <option value="LIMIT">Limit</option>
          <option value="STOP_MARKET">Stop Market</option>
        </select>
      </label>

      {type !== 'MARKET' && (
        <label>
          Price:
          <input 
            type="number" 
            value={price} 
            min={0.01} 
            step={0.01} 
            onChange={e => setPrice(e.target.value)} 
          />
        </label>
      )}

      <label>
        Stop Loss:
        <input 
          type="number" 
          value={stopLoss} 
          min={0} 
          step={0.01} 
          onChange={e => setStopLoss(e.target.value)} 
          placeholder="Optional" 
        />
      </label>

      <label>
        Take Profit:
        <input 
          type="number" 
          value={takeProfit} 
          min={0} 
          step={0.01} 
          onChange={e => setTakeProfit(e.target.value)} 
          placeholder="Optional" 
        />
      </label>

      <label>
        Trailing Stop (e.g. '2%' or '100'):
        <input 
          value={trailingStop} 
          onChange={e => setTrailingStop(e.target.value)} 
          placeholder="Optional"
          maxLength={20}
        />
      </label>

      <label>
        Trade Type:
        <select value={tradeType} onChange={e => setTradeType(e.target.value)}>
          <option value="spot">Spot</option>
          <option value="margin">Margin</option>
        </select>
      </label>

      {tradeType === 'margin' && (
        <label>
          Leverage:
          <div style={{ position: 'relative' }}>
            <input 
              type="number" 
              value={leverage} 
              min={1} 
              max={maxLeverage} 
              step={0.1} 
              onChange={handleLeverageChange}
              onBlur={handleLeverageBlur}
              style={{
                borderColor: warning && tradeType === 'margin' ? '#f59e0b' : undefined
              }}
            />
            <div style={{ 
              fontSize: '11px', 
              color: '#8a93a1', 
              marginTop: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>Range: 1x - {maxLeverage}x</span>
              {leverage > 1 && leverage <= maxLeverage && (
                <span style={{ color: leverage > 5 ? '#f59e0b' : '#16a34a' }}>
                  {leverage > 5 ? '⚠️ High Risk' : '✓ Valid'}
                </span>
              )}
            </div>
          </div>
        </label>
      )}

      <label>
        Tags (comma separated):
        <input 
          value={tags} 
          onChange={e => setTags(e.target.value)}
          placeholder="strategy, test, breakout"
          maxLength={200}
        />
        <div style={{ fontSize: '11px', color: '#8a93a1', marginTop: '4px' }}>
          {tags.split(',').filter(t => t.trim()).length}/10 tags
        </div>
      </label>

      <label>
        Note:
        <textarea 
          value={note} 
          onChange={e => setNote(e.target.value)}
          placeholder="Optional trade notes"
          maxLength={1000}
          rows={3}
        />
        <div style={{ fontSize: '11px', color: '#8a93a1', marginTop: '4px' }}>
          {note.length}/1000 characters
        </div>
      </label>

      <button 
        onClick={handleSubmit}
        style={{
          padding: '12px',
          background: 'linear-gradient(135deg, #fcd535, #f5a623)',
          color: '#0b0e11',
          border: 'none',
          borderRadius: '8px',
          fontWeight: 700,
          cursor: 'pointer',
          fontSize: '14px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        Place Order
      </button>
    </div>
  );
}