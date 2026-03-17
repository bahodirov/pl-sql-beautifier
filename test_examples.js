const fs = require('fs');
const path = require('path');
const { format, DEFAULT_CONFIG } = require('./out/formatter/index.js');

const FOLDERS = [
  'd:/projects/smartup5x_anor/main/oracle',
  'd:/projects/smartup5x_trade/main/oracle',
];

function findFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) results = results.concat(findFiles(full));
      else if (e.name.endsWith('.pkb') || e.name.endsWith('.pks')) results.push(full);
    }
  } catch {}
  return results;
}

const files = findFiles(FOLDERS[0]).concat(findFiles(FOLDERS[1]));

function showDiff(label, file, srcLines, outLines, srcStart, srcEnd, outStart, outEnd) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`EXAMPLE: ${label}`);
  console.log(`FILE: ${path.basename(file)}`);
  console.log(`${'─'.repeat(80)}`);
  console.log('ORIGINAL:');
  for (let i = srcStart; i < Math.min(srcEnd, srcLines.length); i++) {
    console.log(`  ${String(i+1).padStart(4)}: ${srcLines[i]}`);
  }
  console.log('FORMATTED:');
  for (let i = outStart; i < Math.min(outEnd, outLines.length); i++) {
    console.log(`  ${String(i+1).padStart(4)}: ${outLines[i]}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 1: Missing blank lines between function declarations in .pks
// ═══════════════════════════════════════════════════════════════════════════════
{
  // Find a .pks with multiple function declarations close together
  const target = files.find(f => f.endsWith('.pks') && path.basename(f).includes('util'));
  if (target) {
    const src = fs.readFileSync(target, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const srcLines = src.split('\n');
    const outLines = out.split('\n');

    // Find spot with back-to-back function decls in src
    let found = -1;
    for (let i = 1; i < srcLines.length - 1; i++) {
      if (/^\s+(Function|Procedure)\s/i.test(srcLines[i]) &&
          /^\s+(Function|Procedure)\s/i.test(srcLines[i+2]) &&
          srcLines[i+1].trim() === '') {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      showDiff('Missing blank lines between function declarations (.pks)',
        target, srcLines, outLines,
        Math.max(0, found-1), found+6,
        Math.max(0, found-1), found+6);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 2: No trailing newline — show last 5 lines src vs out
// ═══════════════════════════════════════════════════════════════════════════════
{
  const target = files[0]; // first file
  const src = fs.readFileSync(target, 'utf8');
  const out = format(src, DEFAULT_CONFIG);
  const srcLines = src.split('\n');
  const outLines = out.split('\n');
  const n = outLines.length;
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`EXAMPLE: No trailing newline — last 5 lines`);
  console.log(`FILE: ${path.basename(target)}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`ORIGINAL ends with newline: ${src.endsWith('\n')} (${srcLines.length} lines)`);
  console.log(`FORMATTED ends with newline: ${out.endsWith('\n')} (${outLines.length} lines)`);
  console.log('ORIGINAL last 5 lines (repr):');
  srcLines.slice(-5).forEach((l,i) => console.log(`  ${srcLines.length-4+i}: ${JSON.stringify(l)}`));
  console.log('FORMATTED last 5 lines (repr):');
  outLines.slice(-5).forEach((l,i) => console.log(`  ${outLines.length-4+i}: ${JSON.stringify(l)}`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 3: Odd-indented begin/end (dynamic SQL inside execute immediate)
// ═══════════════════════════════════════════════════════════════════════════════
{
  const target = files.find(f => path.basename(f) === 'mkw_util.pkb');
  if (target) {
    const src = fs.readFileSync(target, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const srcLines = src.split('\n');
    const outLines = out.split('\n');

    // Show around line 3466 in output
    const lineIdx = 3464;
    showDiff('Odd-indented begin/end inside dynamic SQL string',
      target, srcLines, outLines,
      Math.max(0, lineIdx - 5), lineIdx + 10,
      Math.max(0, lineIdx - 5), lineIdx + 10);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 4: Missing blank line after package header before first proc
// ═══════════════════════════════════════════════════════════════════════════════
{
  const target = files.find(f => path.basename(f) === 'mdeal_error.pks');
  if (target) {
    const src = fs.readFileSync(target, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const srcLines = src.split('\n');
    const outLines = out.split('\n');

    showDiff('Missing blank line after package header / between procedures',
      target, srcLines, outLines,
      0, 12,
      0, 12);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 5: Double blank line in output
// ═══════════════════════════════════════════════════════════════════════════════
{
  const target = files.find(f => path.basename(f) === 'migr_manual_operation.pkb');
  if (target) {
    const src = fs.readFileSync(target, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const srcLines = src.split('\n');
    const outLines = out.split('\n');

    const lineIdx = 343; // 1-based line 345 → 0-based 344
    showDiff('Double blank line introduced by formatter',
      target, srcLines, outLines,
      lineIdx - 4, lineIdx + 4,
      lineIdx - 4, lineIdx + 4);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 6 (bonus): upstream NOT/OR uppercase keywords
// ═══════════════════════════════════════════════════════════════════════════════
{
  for (const f of files) {
    try {
      const src = fs.readFileSync(f, 'utf8');
      const out = format(src, DEFAULT_CONFIG);
      const outLines = out.split('\n');
      for (let i = 0; i < outLines.length; i++) {
        const clean = outLines[i].replace(/--.*$/, '').replace(/'[^']*'/g, "''");
        if (/\bNOT\b/.test(clean) || /\bOR\b/.test(clean)) {
          const srcLines = src.split('\n');
          showDiff('Remaining uppercase keyword NOT or OR in output',
            f, srcLines, outLines,
            Math.max(0, i-2), i+3,
            Math.max(0, i-2), i+3);
          throw 'done'; // break both loops
        }
      }
    } catch(e) { if (e === 'done') break; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 7: Long line — show a real multi-arg call that wasn't broken
// ═══════════════════════════════════════════════════════════════════════════════
{
  const target = files.find(f => path.basename(f) === 'mcg_core.pkb');
  if (target) {
    const src = fs.readFileSync(target, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const srcLines = src.split('\n');
    const outLines = out.split('\n');

    // line 444 in output
    const lineIdx = 443;
    showDiff('Long line (>200 chars): multi-arg call not line-broken',
      target, srcLines, outLines,
      Math.max(0, lineIdx - 3), lineIdx + 4,
      Math.max(0, lineIdx - 3), lineIdx + 4);
  }
}

console.log(`\n${'═'.repeat(80)}`);
console.log('SUMMARY OF BUGS');
console.log(`${'═'.repeat(80)}`);
console.log(`
1. NO TRAILING NEWLINE (3618 files)
   Every formatted file is missing the final \\n that the original has.
   The formatter strips the last newline from the output.

2. MISSING BLANK LINES BETWEEN CONSECUTIVE PROC/FUNC DECLARATIONS (130+ occurrences)
   When two procedure/function declarations appear back-to-back (or with a
   semicolon-terminated one-liner) the formatter does not insert a blank line
   between them, even though PL/SQL Developer always inserts one blank line
   between each declaration.

3. MISSING BLANK LINE BETWEEN PACKAGE HEADER AND FIRST PROC/FUNC DECLARATION
   Immediately after "create or replace package Foo is" the first Procedure/
   Function declaration should have a blank line before it.

4. DOUBLE BLANK LINE INTRODUCED (1 known, likely more)
   In migr_manual_operation.pkb:345 the formatter outputs two consecutive blank
   lines where there should be only one.

5. ODD-INDENTED BEGIN/END INSIDE EXECUTE IMMEDIATE STRING LITERALS (9 occurrences)
   Content inside string literals that contain PL/SQL (dynamic SQL) is being
   re-indented as if it were live code. Lines like:
     execute immediate 'begin ... end;'
   have their internal keywords indented at odd multiples (21, 19, 15 spaces).
   These should not be touched — the formatter is reformatting string content.

6. UPPERCASE NOT / OR IN OUTPUT (3 occurrences)
   Keywords NOT and OR appear uppercased in 3 places in the output even though
   the formatter is supposed to lowercase all keywords. These are edge cases
   where the keyword-detection regex misses them (likely inside a complex
   expression or after a line continuation).

7. LONG LINES NOT BROKEN (5196 lines > 200 chars)
   Many function/procedure calls with many named arguments are not being
   line-broken. PL/SQL Developer wraps lines at ~120 chars; the formatter
   leaves some calls on a single line even when they are hundreds of chars long.
   (Some may be intentional, but calls like z_Mcg_Action_Bonus_Limits.Exist_Lock
   with 10+ named args remain on one line.)
`);
