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
console.log(`Total: ${files.length} files\n`);

// Issues to track
const issues = {
  uppercase_kw: {},      // keyword → count (keywords that should be lowercase but aren't)
  misformatted: [],      // structural issues
  errors: [],
};

// Keywords that should always be lowercase
const KW_LOWER = ['SELECT','FROM','WHERE','BEGIN','END','IF','THEN','ELSE','ELSIF',
  'LOOP','FOR','WHILE','RETURN','EXCEPTION','WHEN','INTO','AND','OR','NOT','IS','IN',
  'AS','BY','ON','SET','INSERT','UPDATE','DELETE','CREATE','DECLARE','PACKAGE','BODY',
  'NULL','TRUE','FALSE','CASE','ORDER','GROUP','HAVING','JOIN','INNER','OUTER','LEFT',
  'RIGHT','UNION','ALL','EXISTS','BETWEEN','LIKE','MERGE','USING','MATCHED','CURSOR',
  'TYPE','RECORD','TABLE','RAISE','EXIT','OPEN','FETCH','CLOSE','COMMIT','ROLLBACK'];

// Sample 1 in every 10 files for output structure check
let sampleIdx = 0;
const structureIssues = [];

for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const outLines = out.split('\n');
    const base = path.basename(f);

    for (let i = 0; i < outLines.length; i++) {
      const ln = outLines[i];
      // Skip comments and string literals
      const clean = ln.replace(/\/\*.*?\*\//g, '').replace(/--.*$/, '').replace(/'[^']*'/g, "''");

      // Find uppercase keywords outside of hints
      const matches = clean.match(/\b[A-Z]{2,}\b/g);
      if (matches) {
        matches.filter(w => KW_LOWER.includes(w)).forEach(w => {
          issues.uppercase_kw[w] = (issues.uppercase_kw[w] || 0) + 1;
        });
      }
    }

    // Structure checks on every 10th file
    if (sampleIdx++ % 10 === 0) {
      // Check: does output preserve correct indentation patterns?
      // Check: no double blank lines
      let prevBlank = false;
      for (let i = 0; i < outLines.length; i++) {
        const isBlank = outLines[i].trim() === '';
        if (isBlank && prevBlank) {
          structureIssues.push({ type: 'double_blank', file: base, line: i+1 });
        }
        prevBlank = isBlank;
      }
    }

  } catch (e) {
    issues.errors.push({ file: path.basename(f), msg: e.message });
  }
}

console.log('=== REMAINING UPPERCASE KEYWORDS ===');
const sorted = Object.entries(issues.uppercase_kw).sort((a,b) => b[1]-a[1]);
sorted.forEach(([k,v]) => console.log(`  ${k}: ${v}`));

console.log(`\n=== STRUCTURE ISSUES (double blank lines) ===`);
console.log(`  Count: ${structureIssues.length}`);
structureIssues.slice(0,5).forEach(x => console.log(`  ${x.file}:${x.line}`));

console.log(`\n=== ERRORS ===`);
console.log(`  Count: ${issues.errors.length}`);
issues.errors.slice(0,10).forEach(x => console.log(`  ${x.file}: ${x.msg}`));
