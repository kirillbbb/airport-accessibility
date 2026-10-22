import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {query,summarize,calendar,hourly,unionDuration,HOUR,DAY} from '../dist/model.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../dist/data/dataset.json',import.meta.url)));
const full={from:'2026-09-23',to:'2026-10-23',airports:['SVO','VKO','DME','ZIA'],type:'all'};
test('union never double-counts simultaneous airports',()=>{
 assert.equal(unionDuration([[0,10],[5,15],[20,25]]),20);
 const q=query(data,full),s=summarize(q);
 assert.equal(s.count,98);
 assert.ok(s.anyAirport<s.total);
});
test('calendar and hourly preserve duration through midnight and partial last day',()=>{
 const q=query(data,full),s=summarize(q),days=calendar(q),hours=hourly(q);
 assert.equal(days.length,31);assert.ok(days.at(-1).partial);
 assert.equal(days.at(-1).b-days.at(-1).a,51*60000);
 assert.equal(days.reduce((n,d)=>n+d.total,0),s.total);
 assert.equal(hours.reduce((n,h)=>n+h.suspended+h.coordinated,0),s.total);
 assert.equal(hours.reduce((n,h)=>n+h.exposure,0),(q.end-q.start)*4);
 assert.ok(hours.every(h=>h.fraction>=0&&h.fraction<=1));
});
test('type and date filters clip accurately',()=>{
 const q=query(data,{...full,from:'2026-09-23',to:'2026-09-23',airports:['DME'],type:'coordinated'});
 assert.equal(summarize(q).count,1);
 assert.ok(Math.abs(summarize(q).total/60000-119.98333333333)<0.001);
 assert.ok(q.segments[0].start_clipped);
 const a=summarize(query(data,{...full,type:'suspended'})).total;
 const b=summarize(query(data,{...full,type:'coordinated'})).total;
 assert.equal(a+b,summarize(query(data,full)).total);
});
test('empty selections and reverse dates are safe',()=>{
 for(const q of [query(data,{...full,airports:[]}),query(data,{...full,from:'2026-10-22',to:'2026-09-23'})]){
  assert.equal(summarize(q).total,0);assert.equal(summarize(q).count,0);
  assert.ok(hourly(q).every(x=>Number.isFinite(x.fraction)));
 }
});
