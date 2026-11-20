import test from 'node:test';
import assert from 'node:assert/strict';
import { periodAt, validDay, nextLoad, effectiveAvailability } from './database/monthly-load.js';
test('Toronto calendar month including UTC boundary leap and year rollover',()=>{
 assert.deepEqual(periodAt(new Date('2026-12-01T02:00:00Z')),{key:'2026-11',start:'2026-11-01',end:'2026-12-01',last:'2026-11-30',today:'2026-11-30',timeZone:'America/Toronto'});
 assert.equal(periodAt(new Date('2024-02-15T12:00:00Z')).last,'2024-02-29');
 assert.equal(periodAt(new Date('2026-12-15T12:00:00Z')).end,'2027-01-01');
 assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2024-02-29'),true);
});
test('persistent hysteresis and manual precedence',()=>{
 let state=false;assert.deepEqual([4,5,6,5,4].map(n=>state=nextLoad(n,state)),[false,false,true,true,false]);
 assert.equal(nextLoad(5,true),true);assert.equal(nextLoad(5,false),false);
 assert.equal(effectiveAvailability('surcharge',true),'surcharge');
 assert.equal(effectiveAvailability('charge',false),'charge');
 assert.equal(effectiveAvailability('disponible',true),'charge');
});
