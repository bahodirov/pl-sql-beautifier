// Quick sanity test without VSCode
const { format, DEFAULT_CONFIG } = require('../out/formatter');
const fs = require('fs');

const input = fs.readFileSync('./test/fixtures/input-basic.sql', 'utf8');
const result = format(input, DEFAULT_CONFIG);
console.log('=== FORMATTED OUTPUT ===');
console.log(result);
console.log('========================');

// Basic checks
const checks = [
  ['Keywords uppercase', () => /DECLARE/.test(result) && /BEGIN/.test(result) && /END/.test(result)],
  ['THEN on same line as IF', () => /IF .+ THEN/.test(result)],
  ['LOOP on new line', () => /\n\s*LOOP/.test(result)],
  ['to_char lowercase', () => /to_char/.test(result)],
  ['Identifiers lowercase', () => /v_name/.test(result) && /v_count/.test(result)],
  ['EXCEPTION section', () => /EXCEPTION/.test(result)],
  ['Max 1 empty line', () => !/\n\n\n/.test(result)],
];

let passed = 0;
for (const [name, check] of checks) {
  try {
    if (check()) {
      console.log(`✓ ${name}`);
      passed++;
    } else {
      console.log(`✗ ${name}`);
    }
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
  }
}
console.log(`\n${passed}/${checks.length} checks passed`);
