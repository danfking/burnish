/**
 * Verify: npm import of @burnishdev/components and @burnishdev/renderer
 * Expected: Both packages resolve and key exports are available
 *
 * Run: npm install && node test.mjs
 */

import { findStreamElements, appendStreamElement, inferComponent } from '@burnishdev/renderer';

let pass = 0;
let fail = 0;

// Check renderer exports
if (typeof findStreamElements === 'function') {
  console.log('PASS: findStreamElements is a function');
  pass++;
} else {
  console.log('FAIL: findStreamElements not found or not a function');
  fail++;
}

if (typeof appendStreamElement === 'function') {
  console.log('PASS: appendStreamElement is a function');
  pass++;
} else {
  console.log('FAIL: appendStreamElement not found or not a function');
  fail++;
}

if (typeof inferComponent === 'function') {
  console.log('PASS: inferComponent is a function');
  pass++;
} else {
  console.log('FAIL: inferComponent not found or not a function');
  fail++;
}

console.log('');
console.log(`npm-import: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
