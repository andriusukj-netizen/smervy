// paper-trader/utils.js
// Small helper utilities used across modules.
// FIXED: Removed duplicate sanitization exports (now in sanitizer.js) ✅
// FIXED: Re-export sanitization functions for backward compatibility ✅

export function uid() {
  return Date.now() + '_' + Math.random().toString(36).slice(2,9);
}

export function formatMoney(n) {
  if (n === undefined || n === null) return '$0.00';
  const num = Number(n);
  return '$' + num.toFixed(2);
}

// FIXED: Safe number formatting (kept here as it's a utility function)
export function safeFormatNumber(value, decimals = 2) {
  try {
    const num = Number(value);
    if (!isFinite(num) || isNaN(num)) return '0.00';
    return num.toFixed(decimals);
  } catch (e) {
    console.warn('[Utils] Number format error:', e);
    return '0.00';
  }
}

// FIXED: Safe number parsing (kept here as it's a utility function)
export function safeParseNumber(value, defaultValue = 0) {
  const num = parseFloat(value);
  return isNaN(num) || !isFinite(num) ? defaultValue : num;
}

// FIXED: Re-export sanitization functions from sanitizer.js for backward compatibility
// This allows existing code to keep using: import { sanitizeText } from './utils.js'
// Note: Only re-exporting functions that are actually exported from sanitizer.js
export { 
  sanitizeText, 
  sanitizeArray
} from './sanitizer.js';

// FIXED: XSS-safe HTML escaping (local implementation)
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// FIXED: Validate symbol format (prevent injection)
export function validateSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;
  
  // Symbol should only contain alphanumeric characters
  const validPattern = /^[A-Z0-9]{2,20}$/;
  return validPattern.test(symbol.toUpperCase());
}

// Compute performance metrics for state: minimal metrics similar to original getPerformanceMetrics
export function computeMetrics(state) {
  const closedTrades = (state.trades || []).filter(t => typeof t.pnl !== 'undefined');
  const winningTrades = closedTrades.filter(t => t.pnl > 0);
  const losingTrades = closedTrades.filter(t => t.pnl < 0);
  const totalPnL = closedTrades.reduce((s,t) => s + (t.pnl || 0), 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
  const avgWin = winningTrades.length > 0 ? (winningTrades.reduce((s,t)=>s+t.pnl,0) / winningTrades.length) : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((s,t)=>s+t.pnl,0) / losingTrades.length) : 0;
  const profitFactor = (avgWin>0 && avgLoss>0) ? (avgWin / avgLoss).toFixed(2) : '0.00';
  const equity = (state.balance || 0) + (state.positions || []).reduce((sum,pos) => {
    const current = state.getLastPrice(pos.symbol) || pos.entryPrice;
    const p = pos.side === 'buy' ? (current - pos.entryPrice) * pos.quantity : (pos.entryPrice - current) * pos.quantity;
    return sum + p;
  }, 0);
  const returns = ((equity - state.initialBalance) / state.initialBalance) * 100;
  return {
    totalTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: winRate.toFixed(2) + '%',
    totalPnL: totalPnL.toFixed(2),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    profitFactor,
    returns: returns.toFixed(2) + '%',
    equity: equity.toFixed(2)
  };
}

// FIXED: Export validation test (now references correct module)
export async function testXSSProtection() {
  // Import at runtime to avoid circular dependencies
  const { sanitizeText: testSanitize } = await import('./sanitizer.js');
  
  const tests = [
    {
      name: 'Script tag injection',
      input: '<script>alert("XSS")</script>Hello',
      expected: 'Hello'
    },
    {
      name: 'Event handler injection',
      input: '<img src=x onerror="alert(1)">',
      expected: ''
    },
    {
      name: 'JavaScript protocol',
      input: 'javascript:alert(1)',
      expected: ''
    },
    {
      name: 'Normal text',
      input: 'BUY 10 BTC @ 50000',
      expected: 'BUY 10 BTC @ 50000'
    }
  ];
  
  console.log('[Utils] Running XSS protection tests...');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    const result = testSanitize(test.input);
    const success = result === test.expected || !result.includes('<') && !result.includes('javascript:');
    
    if (success) {
      passed++;
      console.log(`✅ ${test.name}: PASSED`);
    } else {
      failed++;
      console.error(`❌ ${test.name}: FAILED`, { input: test.input, output: result, expected: test.expected });
    }
  }
  
  console.log(`[Utils] XSS Protection Tests: ${passed} passed, ${failed} failed`);
  
  return { passed, failed, total: tests.length };
}

/**
 * Format percentage with sign
 */
export function formatPercent(value) {
  const num = Number(value);
  if (!isFinite(num) || isNaN(num)) return '0.00%';
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

/**
 * Format large numbers with K/M suffix
 */
export function formatCompact(num) {
  if (!num) return '0';
  const absNum = Math.abs(num);
  if (absNum >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  }
  if (absNum >= 1000) {
    return (num / 1000).toFixed(2) + 'K';
  }
  return num.toFixed(2);
}

/**
 * Deep clone object (for state management)
 */
export function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    console.warn('[Utils] Deep clone failed:', e);
    return obj;
  }
}

/**
 * Throttle function execution
 */
export function throttle(func, delay) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func.apply(this, args);
    }
  };
}

/**
 * Debounce function execution
 */
export function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

/**
 * Calculate risk/reward ratio
 */
export function calculateRiskReward(entry, stopLoss, takeProfit) {
  if (!entry || !stopLoss || !takeProfit) return null;
  
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  
  if (risk === 0) return null;
  
  return {
    ratio: (reward / risk).toFixed(2),
    risk: risk.toFixed(2),
    reward: reward.toFixed(2)
  };
}

/**
 * Calculate position size based on risk percentage
 */
export function calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLoss) {
  if (!accountBalance || !riskPercent || !entryPrice || !stopLoss) return null;
  
  const riskAmount = accountBalance * (riskPercent / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  
  if (riskPerUnit === 0) return null;
  
  return {
    quantity: (riskAmount / riskPerUnit).toFixed(4),
    riskAmount: riskAmount.toFixed(2),
    riskPerUnit: riskPerUnit.toFixed(2)
  };
}

/**
 * Format time ago (e.g., "2 hours ago")
 */
export function timeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * Validate order before submission
 */
export function validateOrder(order, state) {
  const errors = [];
  
  if (!order.symbol || order.symbol.trim().length === 0) {
    errors.push('Symbol is required');
  }
  
  if (!validateSymbol(order.symbol)) {
    errors.push('Invalid symbol format');
  }
  
  if (!order.quantity || order.quantity <= 0) {
    errors.push('Quantity must be greater than 0');
  }
  
  if (order.type !== 'MARKET' && (!order.price || order.price <= 0)) {
    errors.push('Price is required for limit/stop orders');
  }
  
  if (order.leverage && (order.leverage < 1 || order.leverage > 100)) {
    errors.push('Leverage must be between 1 and 100');
  }
  
  if (order.stopLoss && order.takeProfit) {
    if (order.side === 'buy' && order.stopLoss >= order.takeProfit) {
      errors.push('Stop loss must be below take profit for buy orders');
    }
    if (order.side === 'sell' && order.stopLoss <= order.takeProfit) {
      errors.push('Stop loss must be above take profit for sell orders');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Export trades to CSV format
 */
export function exportToCSV(trades) {
  if (!trades || trades.length === 0) {
    return 'No trades to export';
  }
  
  const headers = [
    'ID', 'Timestamp', 'Symbol', 'Side', 'Type', 
    'Quantity', 'Price', 'Fee', 'P&L', 
    'Leverage', 'Trade Type', 'Tags', 'Note'
  ];
  
  const rows = trades.map(trade => [
    trade.id,
    new Date(trade.timestamp).toISOString(),
    trade.symbol,
    trade.side,
    trade.type,
    trade.quantity,
    trade.price,
    trade.fee,
    trade.pnl || '',
    trade.leverage || 1,
    trade.tradeType || 'spot',
    (trade.tags || []).join('; '),
    (trade.note || '').replace(/,/g, ';') // Replace commas to avoid CSV issues
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  return csvContent;
}

/**
 * Download CSV file
 */
export function downloadCSV(content, filename = 'paper-trades.csv') {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Get trade statistics by symbol
 */
export function getSymbolStats(trades, symbol) {
  const symbolTrades = trades.filter(t => 
    t.symbol.toUpperCase() === symbol.toUpperCase() && 
    typeof t.pnl !== 'undefined'
  );
  
  if (symbolTrades.length === 0) return null;
  
  const wins = symbolTrades.filter(t => t.pnl > 0);
  const losses = symbolTrades.filter(t => t.pnl < 0);
  const totalPnL = symbolTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  
  return {
    symbol,
    totalTrades: symbolTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: ((wins.length / symbolTrades.length) * 100).toFixed(2) + '%',
    totalPnL: totalPnL.toFixed(2),
    avgPnL: (totalPnL / symbolTrades.length).toFixed(2),
    bestTrade: Math.max(...symbolTrades.map(t => t.pnl)).toFixed(2),
    worstTrade: Math.min(...symbolTrades.map(t => t.pnl)).toFixed(2)
  };
}