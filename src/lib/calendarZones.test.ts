import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('local midnight requests in independent timezone processes',()=>{
  it.each([
    ['America/Los_Angeles','2020-01-01T08:00:00.000Z'],
    ['America/New_York','2020-01-01T05:00:00.000Z'],
    ['UTC','2020-01-01T00:00:00.000Z'],
    ['Asia/Tokyo','2019-12-31T15:00:00.000Z']
  ])('%s includes the first local hours',(zone,expected)=>{
    const source=readFileSync('src/lib/calendar.ts','utf8');
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    const url=`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
    const script=`const { localCalendarStartTimestamp }=await import(${JSON.stringify(url)});process.stdout.write(localCalendarStartTimestamp('2020-01-01'));`;
    const result=execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:zone},encoding:'utf8'});
    expect(result).toBe(expected);
  });
});
