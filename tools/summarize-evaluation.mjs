import { readFile } from 'node:fs/promises';
const name = process.argv[2];
if (!name || !/^evaluation-(upstage|nvidia)(-mixed|-text)?-\d+\.json$/.test(name)) throw new Error('INVALID_REPORT_PATH');
const report = JSON.parse(await readFile(`work/harness/mvp-implementation/${name}`, 'utf8'));
console.log(JSON.stringify({ summary: report.summary, incorrect: report.records.filter(x => x.incorrectFields?.length).map(x => ({ caseId: x.caseId, incorrectFields: x.incorrectFields, reviewShape: x.reviewShape })) }));
