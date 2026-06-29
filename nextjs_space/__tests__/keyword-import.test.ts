import {
  parseKeywordFile,
  parseLocation,
  detectFileType,
  escapeFormulaInjection,
  normalizeKeywordLocal,
  enrichRowsWithZip,
  MAX_ROWS,
  MAX_FILE_SIZE_BYTES,
  ParsedRow,
} from '@/lib/keyword-import-parser';

// Helper: build a CSV string
const csv = (lines: string[]) => lines.join('\n');

describe('Keyword/Location Import — file-type detection', () => {
  test('detects csv / tsv / txt by extension', () => {
    expect(detectFileType('keywords.csv', 'a,b')).toBe('csv');
    expect(detectFileType('keywords.tsv', 'a\tb')).toBe('tsv');
    expect(detectFileType('keywords.txt', 'a')).toBe('txt');
  });

  test('rejects unsupported file types (xlsx/pdf/docx)', () => {
    expect(detectFileType('book.xlsx', 'PK..')).toBeNull();
    expect(detectFileType('doc.pdf', '%PDF')).toBeNull();
    expect(detectFileType('file.docx', 'PK..')).toBeNull();
  });

  test('parseKeywordFile returns fatalError for unsupported type', () => {
    const res = parseKeywordFile('whatever', 'data.xlsx');
    expect(res.fatalError).toMatch(/Unsupported file type/i);
    expect(res.rows).toHaveLength(0);
  });
});

describe('Keyword/Location Import — basic CSV with keyword + location', () => {
  test('parses keyword + city/state location (no header)', () => {
    const res = parseKeywordFile(csv(['plumber, Houston TX', 'ac repair, Dallas, TX']), 'k.csv');
    expect(res.fatalError).toBeNull();
    expect(res.rows).toHaveLength(2);
    const r0 = res.rows[0];
    expect(r0.parsedKeyword).toBe('plumber');
    expect(r0.locationType).toBe('city');
    expect(r0.city).toBe('Houston');
    expect(r0.state).toBe('TX');
    expect(r0.status).toBe('ready');
    expect(r0.priority).toBe('medium'); // default
  });

  test('parses CSV with a header row and expanded columns', () => {
    const res = parseKeywordFile(
      csv(['keyword,city,state,priority', 'roofing,Austin,TX,high']),
      'k.csv',
    );
    expect(res.rows).toHaveLength(1);
    const r = res.rows[0];
    expect(r.parsedKeyword).toBe('roofing');
    expect(r.city).toBe('Austin');
    expect(r.state).toBe('TX');
    expect(r.priority).toBe('high');
    expect(r.status).toBe('ready');
  });
});

describe('Keyword/Location Import — TSV and TXT', () => {
  test('parses TSV', () => {
    const res = parseKeywordFile('plumber\tHouston TX', 'k.tsv');
    expect(res.fileType).toBe('tsv');
    expect(res.rows[0].parsedKeyword).toBe('plumber');
    expect(res.rows[0].city).toBe('Houston');
    expect(res.rows[0].state).toBe('TX');
  });

  test('parses TXT with comma split (first comma only)', () => {
    const res = parseKeywordFile('emergency plumber, Houston, TX', 'k.txt');
    expect(res.fileType).toBe('txt');
    expect(res.rows[0].parsedKeyword).toBe('emergency plumber');
    // location text = "Houston, TX"
    expect(res.rows[0].city).toBe('Houston');
    expect(res.rows[0].state).toBe('TX');
  });

  test('parses TXT with tab split', () => {
    const res = parseKeywordFile('drain cleaning\t77041', 'k.txt');
    expect(res.rows[0].parsedKeyword).toBe('drain cleaning');
    expect(res.rows[0].locationType).toBe('zip');
    expect(res.rows[0].zip).toBe('77041');
  });
});

describe('Keyword/Location Import — ZIP handling', () => {
  test('5-digit ZIP free text becomes locationType zip', () => {
    const res = parseKeywordFile(csv(['transmission flush, 77041']), 'k.csv');
    const r = res.rows[0];
    expect(r.locationType).toBe('zip');
    expect(r.zip).toBe('77041');
    // city/state remain blank until ZIP enrichment resolves them
    expect(r.city).toBeNull();
    expect(r.state).toBeNull();
  });

  test('ZIP+4 is truncated to 5 digits', () => {
    const loc = parseLocation({ location: '77041-1234' });
    expect(loc.locationType).toBe('zip');
    expect(loc.zip).toBe('77041');
  });

  test('enrichRowsWithZip fills city/state/county when dataset resolves', async () => {
    const res = parseKeywordFile(csv(['plumber, 77041']), 'k.csv');
    const enriched = await enrichRowsWithZip(res.rows, async (zip) =>
      zip === '77041' ? { city: 'Houston', state: 'TX', county: 'Harris' } : null,
    );
    expect(enriched[0].city).toBe('Houston');
    expect(enriched[0].state).toBe('TX');
    expect(enriched[0].county).toBe('Harris');
  });

  test('enrichRowsWithZip leaves city/state blank when dataset has no match', async () => {
    const res = parseKeywordFile(csv(['plumber, 00000']), 'k.csv');
    const enriched = await enrichRowsWithZip(res.rows, async () => null);
    expect(enriched[0].zip).toBe('00000');
    expect(enriched[0].city).toBeNull();
    expect(enriched[0].state).toBeNull();
  });
});

describe('Keyword/Location Import — city/state parsing forms', () => {
  test('"Houston TX" -> city/state', () => {
    const loc = parseLocation({ location: 'Houston TX' });
    expect(loc.locationType).toBe('city');
    expect(loc.city).toBe('Houston');
    expect(loc.state).toBe('TX');
  });

  test('"Houston, TX" -> city/state', () => {
    const loc = parseLocation({ location: 'Houston, TX' });
    expect(loc.locationType).toBe('city');
    expect(loc.city).toBe('Houston');
    expect(loc.state).toBe('TX');
  });

  test('full state name resolves to code', () => {
    const loc = parseLocation({ location: 'Texas' });
    expect(loc.locationType).toBe('state');
    expect(loc.state).toBe('TX');
  });

  test('multi-word city before state code', () => {
    const loc = parseLocation({ location: 'San Antonio TX' });
    expect(loc.city).toBe('San Antonio');
    expect(loc.state).toBe('TX');
  });
});

describe('Keyword/Location Import — 30-row limit', () => {
  test('exactly 30 rows is accepted', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `keyword${i}, Houston TX`);
    const res = parseKeywordFile(csv(lines), 'k.csv');
    expect(res.fatalError).toBeNull();
    expect(res.rows).toHaveLength(30);
  });

  test('31 rows is rejected with a fatalError', () => {
    const lines = Array.from({ length: 31 }, (_, i) => `keyword${i}, Houston TX`);
    const res = parseKeywordFile(csv(lines), 'k.csv');
    expect(res.fatalError).toMatch(/Maximum is 30 rows/i);
    expect(res.rows).toHaveLength(0);
  });

  test('MAX_ROWS constant is 30 and MAX_FILE_SIZE_BYTES is 1 MB', () => {
    expect(MAX_ROWS).toBe(30);
    expect(MAX_FILE_SIZE_BYTES).toBe(1024 * 1024);
  });
});

describe('Keyword/Location Import — blank rows ignored', () => {
  test('blank lines between data rows are skipped', () => {
    const res = parseKeywordFile(csv(['plumber, Houston TX', '', '   ', 'roofing, Dallas TX']), 'k.csv');
    expect(res.rows).toHaveLength(2);
    expect(res.totalRows).toBe(2);
  });
});

describe('Keyword/Location Import — validation statuses', () => {
  test('missing keyword -> invalid', () => {
    const res = parseKeywordFile(csv([', Houston TX']), 'k.csv');
    expect(res.rows[0].status).toBe('invalid');
    expect(res.rows[0].error).toMatch(/Missing keyword/i);
  });

  test('missing location -> invalid', () => {
    const res = parseKeywordFile(csv(['plumber,']), 'k.csv');
    expect(res.rows[0].status).toBe('invalid');
    expect(res.rows[0].error).toMatch(/Missing location/i);
  });

  test('unparseable location -> needs_review (kept, not dropped)', () => {
    const res = parseKeywordFile(csv(['plumber, Somewhereville']), 'k.csv');
    expect(res.rows[0].status).toBe('needs_review');
    expect(res.rows[0].error).toMatch(/review/i);
  });
});

describe('Keyword/Location Import — in-file duplicate detection', () => {
  test('identical keyword+location flagged as duplicate', () => {
    const res = parseKeywordFile(
      csv(['plumber, Houston TX', 'plumber, Houston TX']),
      'k.csv',
    );
    expect(res.rows[0].status).toBe('ready');
    expect(res.rows[1].status).toBe('duplicate');
    expect(res.rows[1].error).toMatch(/Duplicate/i);
  });

  test('same keyword different location is NOT a duplicate', () => {
    const res = parseKeywordFile(
      csv(['plumber, Houston TX', 'plumber, Dallas TX']),
      'k.csv',
    );
    expect(res.rows[0].status).toBe('ready');
    expect(res.rows[1].status).toBe('ready');
  });
});

describe('Keyword/Location Import — formula injection guard', () => {
  test('cells starting with = + - @ are escaped with a leading quote', () => {
    expect(escapeFormulaInjection('=cmd|calc')).toBe("'=cmd|calc");
    expect(escapeFormulaInjection('+1+1')).toBe("'+1+1");
    expect(escapeFormulaInjection('-2')).toBe("'-2");
    expect(escapeFormulaInjection('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  test('normal text is unchanged', () => {
    expect(escapeFormulaInjection('plumber')).toBe('plumber');
  });

  test('parsed row exposes formula-safe keyword for display/export', () => {
    const res = parseKeywordFile(csv(['=HYPERLINK("x"), Houston TX']), 'k.csv');
    expect(res.rows[0].keyword.startsWith("'")).toBe(true);
    // storage keyword keeps the original raw value
    expect(res.rows[0].parsedKeyword.startsWith('=')).toBe(true);
  });
});

describe('Keyword/Location Import — keyword normalization', () => {
  test('normalizeKeywordLocal lowercases, collapses spaces, strips punctuation', () => {
    expect(normalizeKeywordLocal('  Emergency   Plumber!! ')).toBe('emergency plumber');
  });
});
