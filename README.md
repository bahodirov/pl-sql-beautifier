# PL/SQL Beautifier

A Visual Studio Code extension that formats PL/SQL and SQL code using **PL/SQL Developer–compatible** beautifier rules.

## Features

- Formats PL/SQL packages, procedures, functions, triggers, and anonymous blocks
- Reads your existing **PL/SQL Developer `.br` config file** — no need to reconfigure
- Supports all common PL/SQL constructs:
  - `IF / ELSIF / ELSE / END IF`
  - `CASE / WHEN / ELSE / END CASE`
  - `FOR`, `WHILE`, `LOOP` statements
  - `SELECT / INSERT / UPDATE / DELETE / MERGE` with right-aligned keywords
  - `CURSOR`, `TYPE ... IS RECORD`, `TYPE ... IS TABLE` declarations
  - Exception handlers (`EXCEPTION / WHEN ... THEN`)
  - `CREATE OR REPLACE PROCEDURE / FUNCTION / PACKAGE BODY`
- Declaration group alignment (variable names aligned; `:=` follows the type with one space)
- Assignment group alignment (`:=` signs aligned in BEGIN blocks)
- Parameter list formatting with aligned columns
- Multi-argument function/procedure calls broken across lines, each argument aligned under the first
- Cursor `FOR` loop queries formatted across multiple lines with right-aligned DML keywords
- Automatic blank line before `RETURN` statements for readability
- Query alias lowercasing (`Mrf_Table t` → `t` stays lowercase)
- Separator line preservation (`---------` lines kept at correct indentation)

## Usage

1. Open a `.sql` or `.pkb` / `.pks` file
2. Press `Shift+Alt+F` (Format Document)
3. If prompted, choose **PL/SQL Beautifier**

Or right-click → **Format Document** → **Format Document With...** → **PL/SQL Beautifier**

## Configuration

The extension works out of the box with no configuration needed. Built-in defaults:
- Keywords: lowercase (e.g. `select`, `begin`, `return`)
- Identifiers: lowercase (e.g. `v_result`, `i_filial_id`)
- Special words: `Function`, `Procedure` (capitalized)
- Indent: 2 spaces
- Blank lines: max 1
- DML keywords: right-aligned
- WHERE clause: AND/OR on separate lines

## Formatting Example

**Before:**
```sql
create or replace function get_local_code(i_filial_id number,i_source_code varchar2) return varchar2 is
v_result varchar2(100);
v_use_local_code boolean:=false;
begin
v_use_local_code:=pkg.get_flag(i_company_id=>v_company_id,i_filial_id=>v_filial_id);
select t.local_code into v_result from mrf_local_codes t where t.filial_id=i_filial_id and t.source_code=i_source_code;
return v_result;
exception when no_data_found then return null;
end;
```

**After:**
```sql
create or replace Function get_local_code
(
  i_filial_id    number,
  i_source_code  varchar2
) return varchar2 is
  v_result         varchar2(100);
  v_use_local_code boolean := false;
begin
  v_use_local_code := pkg.get_flag(i_company_id => v_company_id,
                                   i_filial_id => v_filial_id);

  select t.local_code
    into v_result
    from mrf_local_codes t
   where t.filial_id = i_filial_id
     and t.source_code = i_source_code;

  return v_result;
exception
  when no_data_found then
    return null;
end;
```

## Supported File Types

The extension activates for the following language IDs:
- `sql`
- `plsql`
- `oraclesql`
- `oracle-sql`

To associate `.pkb`, `.pks`, `.prc`, `.fnc` files with a supported language, add to your VSCode settings:

```json
"files.associations": {
  "*.pkb": "sql",
  "*.pks": "sql",
  "*.prc": "sql",
  "*.fnc": "sql"
}
```

## Requirements

- Visual Studio Code 1.80.0 or higher

## License

MIT
