/**
 * Verify: @burnishdev/server McpHub import and instantiation
 * Expected: McpHub can be constructed and has expected methods
 *
 * Run: npm install && node test.mjs
 */

import { McpHub } from '@burnishdev/server';

let pass = 0;
let fail = 0;

// Check McpHub can be instantiated
const hub = new McpHub();
if (hub) {
  console.log('PASS: McpHub imported and instantiated');
  pass++;
} else {
  console.log('FAIL: McpHub could not be instantiated');
  fail++;
}

// Check expected methods exist
const proto = Object.getPrototypeOf(hub);
const methods = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor');
console.log(`McpHub methods: ${methods.join(', ')}`);

const expectedMethods = ['initialize', 'shutdown', 'getAllTools', 'getServerInfo'];
for (const method of expectedMethods) {
  if (typeof hub[method] === 'function') {
    console.log(`PASS: hub.${method}() exists`);
    pass++;
  } else {
    console.log(`FAIL: hub.${method}() not found`);
    fail++;
  }
}

console.log('');
console.log(`middleware-sdk: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
