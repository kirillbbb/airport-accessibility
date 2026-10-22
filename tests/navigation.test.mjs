import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveView} from '../dist/navigation.mjs';

test('calendar is the entry point for bare and unknown URLs',()=>{
 for(const hash of ['', '#', '#unknown'])assert.deepEqual(resolveView(hash),{view:'calendar',journal:false});
});
test('current sections remain directly addressable',()=>{
 for(const view of ['calendar','overview','data'])assert.deepEqual(resolveView('#'+view),{view,journal:false});
});
test('old shared links reach retained content',()=>{
 for(const hash of ['#sources','#comparison'])assert.deepEqual(resolveView(hash),{view:'data',journal:false});
 assert.deepEqual(resolveView('#journal'),{view:'overview',journal:true});
});
