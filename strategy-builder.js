// strategy-builder.js: Basic structure

// Strategy format example:
// {
//   name: "EMA Crossover + RSI Oversold",
//   conditions: [
//     { indicator: "EMA20", comparison: "crosses_above", target: "EMA50" },
//     { indicator: "RSI", comparison: "<", value: 30 }
//   ]
// }

const strategies = {}; // symbol => array of strategies

function openStrategyBuilder(symbol) {
  // Show modal, populate current strategies for symbol
}

function saveStrategy(symbol, strategy) {
  if (!strategies[symbol]) strategies[symbol] = [];
  strategies[symbol].push(strategy);
  localStorage.setItem("strategies-" + symbol, JSON.stringify(strategies[symbol]));
}

function loadStrategies(symbol) {
  strategies[symbol] = JSON.parse(localStorage.getItem("strategies-" + symbol) || "[]");
  return strategies[symbol];
}

// Evaluate strategies on each chart update
function evaluateStrategies(symbol, candle, indicators) {
  const activeStrategies = loadStrategies(symbol) || [];
  activeStrategies.forEach(strategy => {
    const triggered = strategy.conditions.every(cond => evaluateCondition(cond, indicators));
    if (triggered) showSignal(strategy, candle);
  });
}

function evaluateCondition(cond, indicators) {
  // Example implementation for EMA crossover, RSI, etc.
  // indicators.EMA20, indicators.EMA50, indicators.RSI
  // Compare according to cond.comparison
  // ...
}

function showSignal(strategy, candle) {
  // Show banner, marker, or notification
}