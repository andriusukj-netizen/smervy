// paper-trader/tests/sanitizer.test.js
// FIXED #39: Comprehensive unit tests for XSS protection
// Tests all sanitization functions with dangerous inputs
// Run with: node sanitizer.test.js or integrate with Jest/Mocha

import { 
  sanitizeText, 
  sanitizeHtml, 
  sanitizeUrl, 
  sanitizeArray, 
  validateContent,
  Sanitizer 
} from '../sanitizer.js';

// Simple test framework (can be replaced with Jest/Mocha)
class TestRunner {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(description, fn) {
    this.tests.push({ description, fn });
  }

  async run() {
    console.log(`\n🧪 Running Test Suite: ${this.name}\n`);
    console.log('='.repeat(60));

    for (const { description, fn } of this.tests) {
      try {
        await fn();
        this.passed++;
        console.log(`✅ ${description}`);
      } catch (error) {
        this.failed++;
        console.error(`❌ ${description}`);
        console.error(`   Error: ${error.message}`);
        if (error.stack) {
          console.error(`   ${error.stack.split('\n')[1]?.trim()}`);
        }
      }
    }

    console.log('='.repeat(60));
    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    console.log(`   Success rate: ${((this.passed / this.tests.length) * 100).toFixed(1)}%\n`);

    return this.failed === 0;
  }
}

// Test helpers
function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n   Expected: "${expected}"\n   Actual: "${actual}"`);
  }
}

function assertContains(actual, substring, message) {
  if (!actual.includes(substring)) {
    throw new Error(`${message}\n   Expected to contain: "${substring}"\n   Actual: "${actual}"`);
  }
}

function assertNotContains(actual, substring, message) {
  if (actual.includes(substring)) {
    throw new Error(`${message}\n   Should not contain: "${substring}"\n   Actual: "${actual}"`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Test Suite 1: Script Tag Injection
const scriptTests = new TestRunner('Script Tag Injection Tests');

scriptTests.test('Remove basic script tag', () => {
  const input = '<script>alert("XSS")</script>Hello';
  const output = sanitizeText(input);
  assertNotContains(output, '<script', 'Should remove script tag');
  assertNotContains(output, 'alert', 'Should remove script content');
});

scriptTests.test('Remove script tag with attributes', () => {
  const input = '<script type="text/javascript" src="evil.js">alert(1)</script>';
  const output = sanitizeText(input);
  assertNotContains(output, '<script', 'Should remove script tag');
  assertNotContains(output, 'evil.js', 'Should remove src attribute');
});

scriptTests.test('Remove multiple script tags', () => {
  const input = '<script>alert(1)</script>Text<script>alert(2)</script>';
  const output = sanitizeText(input);
  assertNotContains(output, '<script', 'Should remove all script tags');
  assertNotContains(output, 'alert', 'Should remove all script content');
});

scriptTests.test('Remove script tag with case variations', () => {
  const input = '<SCRIPT>alert(1)</SCRIPT><ScRiPt>alert(2)</ScRiPt>';
  const output = sanitizeText(input);
  assertNotContains(output, 'SCRIPT', 'Should handle uppercase');
  assertNotContains(output, 'ScRiPt', 'Should handle mixed case');
});

scriptTests.test('Remove nested script tags', () => {
  const input = '<div><script>alert(1)</script></div>';
  const output = sanitizeText(input);
  assertNotContains(output, '<script', 'Should remove nested scripts');
});

// Test Suite 2: Event Handler Injection
const eventTests = new TestRunner('Event Handler Injection Tests');

eventTests.test('Remove onclick handler', () => {
  const input = '<img onclick="alert(1)" src="x">';
  const output = sanitizeText(input);
  assertNotContains(output, 'onclick', 'Should remove onclick');
  assertNotContains(output, 'alert', 'Should remove alert');
});

eventTests.test('Remove onerror handler', () => {
  const input = '<img onerror="alert(1)" src="x">';
  const output = sanitizeText(input);
  assertNotContains(output, 'onerror', 'Should remove onerror');
});

eventTests.test('Remove onload handler', () => {
  const input = '<body onload="malicious()">Content</body>';
  const output = sanitizeText(input);
  assertNotContains(output, 'onload', 'Should remove onload');
  assertNotContains(output, 'malicious', 'Should remove function call');
});

eventTests.test('Remove multiple event handlers', () => {
  const input = '<div onclick="a()" onmouseover="b()" onfocus="c()">Text</div>';
  const output = sanitizeText(input);
  assertNotContains(output, 'onclick', 'Should remove onclick');
  assertNotContains(output, 'onmouseover', 'Should remove onmouseover');
  assertNotContains(output, 'onfocus', 'Should remove onfocus');
});

eventTests.test('Remove event handlers with various quotes', () => {
  const input = `<a onclick='alert(1)' ondblclick="alert(2)">Link</a>`;
  const output = sanitizeText(input);
  assertNotContains(output, 'onclick', 'Should remove single quote handler');
  assertNotContains(output, 'ondblclick', 'Should remove double quote handler');
});

// Test Suite 3: JavaScript Protocol
const protocolTests = new TestRunner('JavaScript Protocol Tests');

protocolTests.test('Remove javascript: protocol', () => {
  const input = '<a href="javascript:alert(1)">Click</a>';
  const output = sanitizeText(input);
  assertNotContains(output, 'javascript:', 'Should remove javascript: protocol');
});

protocolTests.test('Remove javascript: with case variations', () => {
  const input = '<a href="JavaScript:alert(1)">Click</a>';
  const output = sanitizeText(input);
  assertNotContains(output.toLowerCase(), 'javascript:', 'Should handle case variations');
});

protocolTests.test('Remove javascript: in URL sanitization', () => {
  const input = 'javascript:void(0)';
  const output = sanitizeUrl(input);
  assertEquals(output, '', 'Should return empty string for javascript: URLs');
});

protocolTests.test('Allow safe protocols', () => {
  const input = 'https://example.com';
  const output = sanitizeUrl(input);
  assertContains(output, 'https://', 'Should allow https:');
});

// Test Suite 4: Data URL Injection
const dataUrlTests = new TestRunner('Data URL Tests');

dataUrlTests.test('Remove data:text/html URLs', () => {
  const input = 'data:text/html,<script>alert(1)</script>';
  const output = sanitizeUrl(input);
  assertEquals(output, '', 'Should block data:text/html URLs');
});

dataUrlTests.test('Handle data URLs in text', () => {
  const input = '<img src="data:text/html,<script>alert(1)</script>">';
  const output = sanitizeText(input);
  assertNotContains(output, 'data:text/html', 'Should remove data URL');
});

// Test Suite 5: HTML Tag Injection
const htmlTests = new TestRunner('HTML Tag Injection Tests');

htmlTests.test('Remove iframe tags', () => {
  const input = '<iframe src="evil.com"></iframe>';
  const output = sanitizeText(input);
  assertNotContains(output, '<iframe', 'Should remove iframe');
});

htmlTests.test('Remove object tags', () => {
  const input = '<object data="evil.swf"></object>';
  const output = sanitizeText(input);
  assertNotContains(output, '<object', 'Should remove object');
});

htmlTests.test('Remove embed tags', () => {
  const input = '<embed src="evil.swf">';
  const output = sanitizeText(input);
  assertNotContains(output, '<embed', 'Should remove embed');
});

htmlTests.test('Remove meta refresh', () => {
  const input = '<meta http-equiv="refresh" content="0;url=evil.com">';
  const output = sanitizeText(input);
  assertNotContains(output, 'http-equiv', 'Should remove meta refresh');
});

htmlTests.test('Remove base tag', () => {
  const input = '<base href="http://evil.com/">';
  const output = sanitizeText(input);
  assertNotContains(output, '<base', 'Should remove base tag');
});

htmlTests.test('Remove form tags', () => {
  const input = '<form action="evil.com"><input name="password"></form>';
  const output = sanitizeText(input);
  assertNotContains(output, '<form', 'Should remove form tag');
});

// Test Suite 6: Array Sanitization
const arrayTests = new TestRunner('Array Sanitization Tests');

arrayTests.test('Sanitize array of strings', () => {
  const input = ['<script>alert(1)</script>', 'safe', 'onclick="alert(2)"'];
  const output = sanitizeArray(input);
  assertTrue(Array.isArray(output), 'Should return array');
  assertEquals(output.length, 2, 'Should filter out dangerous items');
  assertNotContains(output.join(''), '<script', 'Should remove scripts');
});

arrayTests.test('Handle non-array input', () => {
  const input = 'not an array';
  const output = sanitizeArray(input);
  assertTrue(Array.isArray(output), 'Should return empty array');
  assertEquals(output.length, 0, 'Should be empty for non-array');
});

arrayTests.test('Limit array size', () => {
  const input = Array(200).fill('tag');
  const output = sanitizeArray(input);
  assertEquals(output.length, 100, 'Should limit to 100 items');
});

arrayTests.test('Filter empty strings', () => {
  const input = ['tag1', '', '   ', 'tag2'];
  const output = sanitizeArray(input);
  assertEquals(output.length, 2, 'Should filter empty/whitespace');
  assertEquals(output[0], 'tag1', 'Should preserve valid items');
  assertEquals(output[1], 'tag2', 'Should preserve valid items');
});

// Test Suite 7: Content Validation
const validationTests = new TestRunner('Content Validation Tests');

validationTests.test('Detect script injection', () => {
  const input = '<script>alert(1)</script>Hello';
  const result = validateContent(input);
  assertEquals(result.safe, false, 'Should detect as unsafe');
  assertTrue(result.issues.length > 0, 'Should list issues');
});

validationTests.test('Pass safe content', () => {
  const input = 'This is safe content with no HTML';
  const result = validateContent(input);
  assertEquals(result.safe, true, 'Should detect as safe');
  assertEquals(result.issues.length, 0, 'Should have no issues');
});

validationTests.test('Provide sanitized version', () => {
  const input = '<script>alert(1)</script>Hello';
  const result = validateContent(input);
  assertNotContains(result.sanitized, '<script', 'Should provide sanitized version');
});

// Test Suite 8: Edge Cases
const edgeTests = new TestRunner('Edge Case Tests');

edgeTests.test('Handle null input', () => {
  const output = sanitizeText(null);
  assertEquals(output, '', 'Should return empty string for null');
});

edgeTests.test('Handle undefined input', () => {
  const output = sanitizeText(undefined);
  assertEquals(output, '', 'Should return empty string for undefined');
});

edgeTests.test('Handle empty string', () => {
  const output = sanitizeText('');
  assertEquals(output, '', 'Should return empty string');
});

edgeTests.test('Handle very long input', () => {
  const input = 'A'.repeat(20000);
  const output = sanitizeText(input);
  assertEquals(output.length, 10000, 'Should truncate to max length');
});

edgeTests.test('Handle special characters', () => {
  const input = 'Test & "quotes" <brackets>';
  const output = sanitizeText(input);
  // Should encode HTML entities
  assertTrue(output.length > 0, 'Should not be empty');
  assertNotContains(output, '<', 'Should encode brackets');
});

edgeTests.test('Preserve normal text', () => {
  const input = 'BUY 10 BTC @ 50000 with stop loss at 48000';
  const output = sanitizeText(input);
  assertContains(output, 'BUY', 'Should preserve normal text');
  assertContains(output, '50000', 'Should preserve numbers');
});

edgeTests.test('Handle unicode characters', () => {
  const input = 'Trade emoji 🚀 and symbols ™️';
  const output = sanitizeText(input);
  assertContains(output, 'Trade', 'Should preserve text');
  assertTrue(output.length > 0, 'Should not be empty');
});

// Test Suite 9: Real-world Trade Examples
const tradeTests = new TestRunner('Real-world Trade Example Tests');

tradeTests.test('Sanitize trade note with XSS attempt', () => {
  const input = 'Good trade! <script>alert(document.cookie)</script>';
  const output = sanitizeText(input);
  assertContains(output, 'Good trade', 'Should preserve valid content');
  assertNotContains(output, '<script', 'Should remove XSS attempt');
});

tradeTests.test('Sanitize trade tags', () => {
  const input = ['breakout', '<img onerror="alert(1)">', 'momentum'];
  const output = sanitizeArray(input);
  assertTrue(output.includes('breakout'), 'Should preserve valid tags');
  assertTrue(output.includes('momentum'), 'Should preserve valid tags');
  assertNotContains(output.join(''), 'onerror', 'Should remove XSS');
});

tradeTests.test('Sanitize symbol with injection attempt', () => {
  const input = 'BTCUSDT<script>alert(1)</script>';
  const output = sanitizeText(input);
  assertNotContains(output, '<script', 'Should remove script');
  assertContains(output, 'BTCUSDT', 'Should preserve symbol');
});

// Test Suite 10: Sanitizer Class Methods
const classTests = new TestRunner('Sanitizer Class Tests');

classTests.test('Sanitizer instance creation', () => {
  const sanitizer = new Sanitizer();
  assertTrue(sanitizer instanceof Sanitizer, 'Should create instance');
  assertTrue(sanitizer.dangerousPatterns !== undefined, 'Should have patterns');
});

classTests.test('Get sanitizer stats', () => {
  const sanitizer = new Sanitizer();
  const stats = sanitizer.getStats();
  assertTrue(stats.patterns > 0, 'Should have patterns');
  assertTrue(Array.isArray(stats.allowedTags), 'Should have allowed tags');
});

classTests.test('Create safe HTML string', () => {
  const sanitizer = new Sanitizer();
  const userInput = '<script>alert(1)</script>';
  const result = sanitizer.createSafeHtml`User said: ${userInput}`;
  assertContains(result, 'User said:', 'Should preserve template');
  assertNotContains(result, '<script', 'Should sanitize interpolation');
});

// Run all test suites
async function runAllTests() {
  console.log('\n🚀 Paper Trader - Sanitizer Test Suite');
  console.log('Testing XSS protection and input sanitization\n');

  const suites = [
    scriptTests,
    eventTests,
    protocolTests,
    dataUrlTests,
    htmlTests,
    arrayTests,
    validationTests,
    edgeTests,
    tradeTests,
    classTests
  ];

  let allPassed = true;

  for (const suite of suites) {
    const passed = await suite.run();
    if (!passed) allPassed = false;
  }

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED! Sanitization is working correctly.\n');
    return 0;
  } else {
    console.log('❌ SOME TESTS FAILED. Please review the errors above.\n');
    return 1;
  }
}

// Export for module usage
export { runAllTests, TestRunner };

// Run tests if executed directly
if (typeof process !== 'undefined' && process.argv[1] === new URL(import.meta.url).pathname) {
  runAllTests().then(exitCode => {
    if (typeof process !== 'undefined') {
      process.exit(exitCode);
    }
  });
}