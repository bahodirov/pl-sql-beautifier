const { format, DEFAULT_CONFIG } = require('./out/formatter/index.js');

// Test trailing newline
const src1 = `create or replace package body Foo is
  Procedure Bar is
  begin
    null;
  end;
end;
/
`;
const out1 = format(src1, DEFAULT_CONFIG);
console.log('=== Trailing newline test ===');
console.log('Input ends with newline:', JSON.stringify(src1.slice(-3)));
console.log('Output ends with newline:', JSON.stringify(out1.slice(-3)));
console.log('Expected: output should end with \\n');
console.log();

// Test missing blank between procs
const src2 = `create or replace package Foo is
  Procedure Proc_One(i_Id number);
  Procedure Proc_Two(i_Id number);
  Procedure Proc_Three(i_Id number);
end;
/`;
const out2 = format(src2, DEFAULT_CONFIG);
console.log('=== Missing blank between procs ===');
console.log('OUTPUT:');
out2.split('\n').forEach((l, i) => console.log(`  ${i+1}: ${JSON.stringify(l)}`));
console.log();
console.log('Expected: blank line between each Procedure declaration');

// Test missing blank after package header
const src3 = `create or replace package body Foo is
  Function t(i_Msg varchar2) return varchar2;
  Procedure Proc_One(i_Id number);
end;
/`;
const out3 = format(src3, DEFAULT_CONFIG);
console.log('\n=== Missing blank after package header ===');
console.log('OUTPUT:');
out3.split('\n').forEach((l, i) => console.log(`  ${i+1}: ${JSON.stringify(l)}`));
