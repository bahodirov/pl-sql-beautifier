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

// ── Bug 1: Collapsed for-loop cursor query ─────────────────────────────────
// Find files where the formatter collapsed a multi-line "for r in (select...)"
// into a single giant line
console.log('=== BUG: FOR-LOOP CURSOR QUERIES COLLAPSED INTO ONE LINE ===');
let collapseCount = 0;
for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const outLines = out.split('\n');
    for (let i = 0; i < outLines.length; i++) {
      const ln = outLines[i];
      if (ln.length > 300 && /for\s+\w+\s+in\s*\(/i.test(ln)) {
        collapseCount++;
        if (collapseCount <= 3) {
          const srcLines = src.split('\n');
          // Find equivalent in source
          let srcFound = -1;
          for (let j = 0; j < srcLines.length; j++) {
            if (/for\s+\w+\s+in\s*\(/i.test(srcLines[j]) || /for\s+\w+\s+in\s*\(?\s*$/.test(srcLines[j])) {
              srcFound = j;
              break;
            }
          }
          console.log(`\n  File: ${path.basename(f)}, output line ${i+1}, length=${ln.length}`);
          if (srcFound >= 0) {
            console.log(`  SOURCE (lines ${srcFound+1}-${srcFound+5}):`);
            for (let j = srcFound; j < Math.min(srcFound+5, srcLines.length); j++) {
              console.log(`    ${j+1}: ${srcLines[j]}`);
            }
          }
          console.log(`  FORMATTED (truncated to 200 chars):`);
          console.log(`    ${i+1}: ${ln.substring(0,200)}...`);
        }
      }
    }
  } catch {}
}
console.log(`  Total collapsed for-loop cursor queries: ${collapseCount}\n`);

// ── Bug 2: Trailing newline analysis ─────────────────────────────────────────
console.log('=== BUG: TRAILING NEWLINE ===');
{
  const f = files[0];
  const src = fs.readFileSync(f, 'utf8');
  const out = format(src, DEFAULT_CONFIG);
  console.log(`  src ends with \\n: ${src.endsWith('\n')}`);
  console.log(`  out ends with \\n: ${out.endsWith('\n')}`);
  console.log(`  src last char codes: ${[...src.slice(-5)].map(c=>c.charCodeAt(0))}`);
  console.log(`  out last char codes: ${[...out.slice(-5)].map(c=>c.charCodeAt(0))}`);
  console.log();
}

// ── Bug 3: WITH clause lines joined into one ──────────────────────────────────
console.log('=== BUG: WITH CLAUSE COLLAPSED INTO ONE LINE ===');
let withCount = 0;
for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const outLines = out.split('\n');
    for (let i = 0; i < outLines.length; i++) {
      const ln = outLines[i];
      if (ln.length > 300 && /\bwith\b.*\bselect\b/i.test(ln)) {
        withCount++;
        if (withCount <= 2) {
          console.log(`  File: ${path.basename(f)}, output line ${i+1}, length=${ln.length}`);
          console.log(`  First 200 chars: ${ln.substring(0,200)}`);
        }
      }
    }
  } catch {}
}
console.log(`  Total WITH clauses collapsed to one line: ${withCount}\n`);

// ── Bug 4: Semicolon-terminated single-line proc decl not followed by blank ──
console.log('=== BUG: PROC/FUNC DECLARATIONS WITHOUT BLANK LINES BETWEEN THEM ===');
let noBlankCount = 0;
const noBlankExamples = [];
for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const srcLines = src.split('\n');
    const outLines = out.split('\n');
    for (let i = 1; i < outLines.length; i++) {
      const cur = outLines[i].trim();
      const prev = outLines[i-1].trim();
      // A procedure/function decl line directly following another declaration line (no blank)
      if (/^(Function|Procedure)\s/i.test(cur) && prev !== '' && !/^--/.test(prev) && !/^\/\*/.test(prev)) {
        noBlankCount++;
        if (noBlankExamples.length < 5) {
          // Show original context too
          const base = path.basename(f);
          // find in src
          let srcCtx = [];
          for (let j = 0; j < srcLines.length; j++) {
            if (srcLines[j].trim().toLowerCase().startsWith(cur.toLowerCase().split('(')[0].toLowerCase())) {
              srcCtx = srcLines.slice(Math.max(0,j-2), j+3);
              break;
            }
          }
          noBlankExamples.push({ file: base, line: i+1, prev, cur, srcCtx, outCtx: outLines.slice(Math.max(0,i-2),i+3) });
        }
      }
    }
  } catch {}
}
console.log(`  Total proc/func decls without preceding blank line: ${noBlankCount}`);
noBlankExamples.forEach((ex, idx) => {
  console.log(`\n  Example ${idx+1}: ${ex.file}:${ex.line}`);
  console.log(`    ORIGINAL context:`);
  ex.srcCtx.forEach(l => console.log(`      ${l}`));
  console.log(`    FORMATTED context:`);
  ex.outCtx.forEach(l => console.log(`      ${l}`));
});
console.log();

// ── Bug 5: Check if formatter changes line count significantly ────────────────
console.log('=== LINE COUNT CHANGES (formatter vs original) ===');
const lcChanges = [];
for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const srcCount = src.split('\n').length;
    const outCount = out.split('\n').length;
    const diff = outCount - srcCount;
    if (Math.abs(diff) > 20) {
      lcChanges.push({ file: path.basename(f), srcCount, outCount, diff });
    }
  } catch {}
}
lcChanges.sort((a,b) => Math.abs(b.diff) - Math.abs(a.diff));
console.log(`  Files with >20 line count difference: ${lcChanges.length}`);
lcChanges.slice(0,10).forEach(x => console.log(`  ${x.file}: ${x.srcCount} → ${x.outCount} (${x.diff > 0 ? '+' : ''}${x.diff})`));
console.log();

// ── Bug 6: inline IF-THEN on same line (should be split) ─────────────────────
console.log('=== SINGLE-LINE IF-THEN (should split) ===');
let inlineIfCount = 0;
for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const outLines = out.split('\n');
    for (const ln of outLines) {
      const clean = ln.replace(/--.*$/, '').replace(/'[^']*'/g, "''");
      if (/\bif\b.*\bthen\b.*\breturn\b/i.test(clean) || /\bif\b.*\bthen\b.*\bnull\b.*;/i.test(clean)) {
        inlineIfCount++;
      }
    }
  } catch {}
}
console.log(`  Single-line if-then (if ... then ... return/null): ${inlineIfCount}\n`);

// ── Bug 7: Check CASE expression handling ─────────────────────────────────────
console.log('=== CASE WHEN on same line as END ===');
let caseEndCount = 0;
for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const outLines = out.split('\n');
    for (let i = 1; i < outLines.length; i++) {
      const ln = outLines[i];
      // "end case;" should be on its own line at a certain indent
      if (/\bend\s+case\b/i.test(ln) && /\bthen\b/i.test(ln)) {
        caseEndCount++;
      }
    }
  } catch {}
}
console.log(`  Lines with both THEN and END CASE (possible collapse): ${caseEndCount}\n`);
