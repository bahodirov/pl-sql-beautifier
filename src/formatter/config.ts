import * as fs from 'fs';

export interface ItemListConfig {
  format: 1 | 2;       // 1=each on new line, 2=single line if fits
  align: boolean;
  commaAfter: boolean;
  atLeftMargin: boolean;
}

export interface BeautifierConfig {
  rightMargin: number;
  indent: number;
  useTabCharacter: boolean;
  tabCharacterSize: number;
  alignDeclarationGroups: boolean;
  alignAssignmentGroups: boolean;
  keywordCase: 'UPPER' | 'LOWER' | 'INIT_CAP' | 'PRESERVE';
  identifierCase: 'PRESERVE' | 'UPPER' | 'LOWER' | 'INIT_CAP';
  useSpecialCase: boolean;
  specialCaseWords: Map<string, string>; // lowercase key -> original value
  itemList: ItemListConfig;
  emptyLines: number;
  thenOnNewLine: boolean;
  loopOnNewLine: boolean;
  dml: {
    leftAlignKeywords: boolean;
    leftAlignItems: boolean;
    onOneLineIfPossible: boolean;
    where: {
      splitAndOr: boolean;
      andOrAfterExpression: boolean;
      andOrUnderWhere: boolean;
    };
    joinSplitBeforeOn: boolean;
    insertItemList: ItemListConfig;
    selectItemList: ItemListConfig;
    updateItemList: ItemListConfig;
  };
  parameterDeclarationList: ItemListConfig;
  recordFieldList: ItemListConfig;
  splitAndOr: boolean;
  andOrAfterExpression: boolean;
}

export const DEFAULT_CONFIG: BeautifierConfig = {
  rightMargin: 100,
  indent: 2,
  useTabCharacter: false,
  tabCharacterSize: 2,
  alignDeclarationGroups: true,
  alignAssignmentGroups: false,
  keywordCase: 'LOWER',
  identifierCase: 'INIT_CAP',
  useSpecialCase: true,
  specialCaseWords: new Map([
    ['ex', 'ex'],
    ['function', 'Function'],
    ['out', 'out'],
    ['procedure', 'Procedure'],
    ['to_char', 'to_char'],
    ['to_date', 'to_date'],
    ['to_number', 'to_number'],
  ]),
  itemList: { format: 1, align: true, commaAfter: true, atLeftMargin: false },
  emptyLines: 1,
  thenOnNewLine: false,
  loopOnNewLine: true,
  dml: {
    leftAlignKeywords: false,
    leftAlignItems: false,
    onOneLineIfPossible: false,
    where: {
      splitAndOr: true,
      andOrAfterExpression: false,
      andOrUnderWhere: true,
    },
    joinSplitBeforeOn: true,
    insertItemList: { format: 1, align: false, commaAfter: true, atLeftMargin: false },
    selectItemList: { format: 1, align: true, commaAfter: true, atLeftMargin: false },
    updateItemList: { format: 2, align: true, commaAfter: true, atLeftMargin: false },
  },
  parameterDeclarationList: { format: 2, align: true, commaAfter: true, atLeftMargin: false },
  recordFieldList: { format: 1, align: true, commaAfter: true, atLeftMargin: false },
  splitAndOr: false,
  andOrAfterExpression: false,
};

function parseBool(v: string): boolean {
  return v.trim().toUpperCase() === 'TRUE';
}

function parseItemList(prefix: string, lines: Map<string, string>): ItemListConfig {
  const fmt = parseInt(lines.get(`${prefix}.Format`) ?? '1', 10) as 1 | 2;
  return {
    format: fmt === 2 ? 2 : 1,
    align: parseBool(lines.get(`${prefix}.Align`) ?? 'FALSE'),
    commaAfter: parseBool(lines.get(`${prefix}.CommaAfter`) ?? 'TRUE'),
    atLeftMargin: parseBool(lines.get(`${prefix}.AtLeftMargin`) ?? 'FALSE'),
  };
}

export function parseBrFile(filePath: string): BeautifierConfig {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const kvMap = new Map<string, string>();
  const specialCaseWords = new Map<string, string>();
  let inSpecialCase = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === '[SpecialCase]') {
      inSpecialCase = true;
      continue;
    }
    if (trimmed.startsWith('[') && trimmed !== '[SpecialCase]') {
      inSpecialCase = false;
      continue;
    }
    if (inSpecialCase) {
      if (trimmed) {
        specialCaseWords.set(trimmed.toLowerCase(), trimmed);
      }
    } else {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        kvMap.set(trimmed.substring(0, eqIdx).trim(), trimmed.substring(eqIdx + 1).trim());
      }
    }
  }

  const keywordCaseNum = parseInt(kvMap.get('KeywordCase') ?? '2', 10);
  // PL/SQL Developer: 1=Preserve, 2=Uppercase, 3=Lowercase
  const keywordCase: BeautifierConfig['keywordCase'] =
    keywordCaseNum === 1 ? 'PRESERVE' :
    keywordCaseNum === 3 ? 'LOWER' : 'UPPER'; // 2=UPPER

  const identCaseNum = parseInt(kvMap.get('IdentifierCase') ?? '3', 10);
  // PL/SQL Developer: 1=Preserve, 2=Uppercase, 3=Lowercase, 4=Init_Cap
  const identifierCase: BeautifierConfig['identifierCase'] =
    identCaseNum === 1 ? 'PRESERVE' :
    identCaseNum === 2 ? 'UPPER' :
    identCaseNum === 4 ? 'INIT_CAP' : 'LOWER'; // 3=LOWER

  return {
    rightMargin: parseInt(kvMap.get('RightMargin') ?? '100', 10),
    indent: parseInt(kvMap.get('Indent') ?? '2', 10),
    useTabCharacter: parseBool(kvMap.get('UseTabCharacter') ?? 'FALSE'),
    tabCharacterSize: parseInt(kvMap.get('TabCharacterSize') ?? '2', 10),
    alignDeclarationGroups: parseBool(kvMap.get('AlignDeclarationGroups') ?? 'TRUE'),
    alignAssignmentGroups: parseBool(kvMap.get('AlignAssignmentGroups') ?? 'TRUE'),
    keywordCase,
    identifierCase,
    useSpecialCase: parseBool(kvMap.get('UseSpecialCase') ?? 'TRUE'),
    specialCaseWords: specialCaseWords.size > 0 ? specialCaseWords : DEFAULT_CONFIG.specialCaseWords,
    itemList: parseItemList('ItemList', kvMap),
    emptyLines: parseInt(kvMap.get('EmptyLines') ?? '1', 10),
    thenOnNewLine: parseBool(kvMap.get('ThenOnNewLine') ?? 'FALSE'),
    loopOnNewLine: parseBool(kvMap.get('LoopOnNewLine') ?? 'TRUE'),
    dml: {
      leftAlignKeywords: parseBool(kvMap.get('DML.LeftAlignKeywords') ?? 'FALSE'),
      leftAlignItems: parseBool(kvMap.get('DML.LeftAlignItems') ?? 'FALSE'),
      onOneLineIfPossible: parseBool(kvMap.get('DML.OnOneLineIfPossible') ?? 'FALSE'),
      where: {
        splitAndOr: parseBool(kvMap.get('DML.WhereSplitAndOr') ?? 'TRUE'),
        andOrAfterExpression: parseBool(kvMap.get('DML.WhereAndOrAfterExpression') ?? 'FALSE'),
        andOrUnderWhere: parseBool(kvMap.get('DML.WhereAndOrUnderWhere') ?? 'TRUE'),
      },
      joinSplitBeforeOn: parseBool(kvMap.get('DML.JoinSplitBeforeOn') ?? 'TRUE'),
      insertItemList: parseItemList('DML.InsertItemList', kvMap),
      selectItemList: parseItemList('DML.SelectItemList', kvMap),
      updateItemList: parseItemList('DML.UpdateItemList', kvMap),
    },
    parameterDeclarationList: parseItemList('ParameterDeclarationList', kvMap),
    recordFieldList: parseItemList('RecordFieldList', kvMap),
    splitAndOr: parseBool(kvMap.get('SplitAndOr') ?? 'FALSE'),
    andOrAfterExpression: parseBool(kvMap.get('AndOrAfterExpression') ?? 'FALSE'),
  };
}
