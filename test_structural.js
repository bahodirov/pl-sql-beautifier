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

// Track various issue categories
const cats = {
  end_indent:         [],   // end; at wrong indent (not 0 or 2)
  missing_blank_between_procs: [],
  keyword_case:       [],   // Function/Procedure not Init_Cap
  extra_spaces:       [],   // alignment spaces removed incorrectly
  begin_indent:       [],   // begin at wrong indent
  double_blank:       [],
  no_trailing_newline:[],
  in_out_spacing:     [],   // IN OUT / IN / OUT not properly spaced
  long_line:          [],   // lines > 200 chars (possible concat error)
};

let checked = 0;

for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    const out = format(src, DEFAULT_CONFIG);
    const srcLines = src.split('\n');
    const outLines = out.split('\n');
    const base = path.basename(f);

    // ── 1. end; at wrong indent ──────────────────────────────────────────────
    for (let i = 0; i < outLines.length; i++) {
      const ln = outLines[i];
      const trimmed = ln.trim().toLowerCase();
      const indent = ln.match(/^(\s*)/)[1].length;

      if (/^end[\s;]/.test(trimmed) || trimmed === 'end;' || trimmed === 'end') {
        // top-level end should be at col 0; block end at col 2; nested at multiples of 2
        if (indent % 2 !== 0) {
          cats.end_indent.push({ file: base, line: i+1, text: ln.trimEnd() });
        }
      }

      // ── 2. begin at wrong indent ────────────────────────────────────────────
      if (trimmed === 'begin') {
        if (indent % 2 !== 0) {
          cats.begin_indent.push({ file: base, line: i+1, text: ln.trimEnd() });
        }
      }

      // ── 3. Double blank lines ───────────────────────────────────────────────
      if (ln.trim() === '' && i > 0 && outLines[i-1].trim() === '') {
        cats.double_blank.push({ file: base, line: i+1 });
      }

      // ── 4. Keyword case: Function/Procedure should be Init_Cap ──────────────
      // Check if raw uppercase FUNCTION/PROCEDURE appears at line start (not in comments)
      const clean = ln.replace(/--.*$/, '');
      if (/^\s*(FUNCTION|PROCEDURE)\s+\w+/i.test(clean)) {
        const kw = clean.match(/^\s*(function|procedure)/i)[1];
        if (kw !== kw[0].toUpperCase() + kw.slice(1).toLowerCase()) {
          cats.keyword_case.push({ file: base, line: i+1, text: ln.trimEnd().substring(0, 80) });
        }
      }

      // ── 5. Long lines (possible join error) ─────────────────────────────────
      if (ln.length > 200) {
        cats.long_line.push({ file: base, line: i+1, len: ln.length, text: ln.substring(0, 100) + '...' });
      }
    }

    // ── 6. Missing blank line between procedure/function defs ────────────────
    for (let i = 1; i < outLines.length; i++) {
      const cur = outLines[i].trim().toLowerCase();
      const prev = outLines[i-1].trim().toLowerCase();
      if (/^(function|procedure)\s/.test(cur) && prev !== '' && !/^\s*(--|\/\*)/.test(outLines[i-1])) {
        // prev should be blank (or a comment); if it's an end; that's ok
        if (!/^end/.test(prev)) {
          cats.missing_blank_between_procs.push({ file: base, line: i+1, prev: outLines[i-1].trimEnd().substring(0,60), cur: outLines[i].trimEnd().substring(0,60) });
        }
      }
    }

    // ── 7. Trailing newline ──────────────────────────────────────────────────
    if (!out.endsWith('\n')) {
      cats.no_trailing_newline.push(base);
    }

    checked++;
  } catch (e) {
    // ignore
  }
}

console.log(`Checked: ${checked} files\n`);

function show(label, arr, limit=8) {
  console.log(`=== ${label} (${arr.length} occurrences) ===`);
  arr.slice(0, limit).forEach(x => {
    if (typeof x === 'string') console.log('  ' + x);
    else if (x.text) console.log(`  ${x.file}:${x.line}  →  ${x.text}`);
    else if (x.prev) console.log(`  ${x.file}:${x.line}\n    prev: ${x.prev}\n    cur:  ${x.cur}`);
    else console.log(`  ${x.file}:${x.line}`);
  });
  console.log();
}

show('END; AT ODD INDENT', cats.end_indent);
show('BEGIN AT ODD INDENT', cats.begin_indent);
show('DOUBLE BLANK LINES', cats.double_blank);
show('KEYWORD CASE (Function/Procedure)', cats.keyword_case);
show('LONG LINES (>200 chars)', cats.long_line);
show('MISSING BLANK BEFORE PROC/FUNC', cats.missing_blank_between_procs, 12);
show('NO TRAILING NEWLINE', cats.no_trailing_newline);
