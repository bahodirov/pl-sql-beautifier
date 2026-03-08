# Changelog

## [0.1.3] - 2026-03-08

### Changed

- **Function/Procedure keyword casing**: `FUNCTION` and `PROCEDURE` keywords are now formatted as `Function` and `Procedure` (Init_Cap) by default, matching PL/SQL Developer convention.
- **Parameter list indentation**: Function/procedure parameters are now indented one level inside the opening parenthesis (e.g. 2 spaces for default indent), giving clearer visual separation.
- **WHERE clause AND/OR indentation**: `AND` and `OR` conditions inside a `WHERE` clause are now indented one extra level from the `WHERE` keyword, making nested conditions easier to read.
- **SQL function names lowercase**: Built-in SQL functions (e.g. `count`, `max`, `min`, `sum`, `nvl`, `to_char`) are now rendered in lowercase when used inside SQL queries.
- **Variable declaration `:=` spacing**: Default values are now written with exactly one space after the type (`boolean := false;`) instead of being pushed far right to align `:=` signs across the group.
- **Multi-argument function call formatting**: Function and procedure calls with more than one argument are now split across multiple lines, with each argument aligned under the first argument (column right after the opening parenthesis).

## [0.1.2] - 2025-01-01

### Added

- Initial release with PL/SQL Developer `.br` config file support
- Formatting for PL/SQL packages, procedures, functions, triggers, and anonymous blocks
- Declaration and assignment group alignment
- Parameter list formatting with aligned columns
- DML statement formatting (SELECT, INSERT, UPDATE, DELETE, MERGE)
- Right-aligned DML keywords (SELECT, FROM, WHERE, etc.)
- WHERE clause AND/OR splitting
- Separator line preservation
