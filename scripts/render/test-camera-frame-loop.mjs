import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/render/mobile/cameraFrameLoop.ts','utf8'),
  {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {createCameraFrameLoop}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let time=0,id=0,draws=0,errors=0,throwFrame=false,frozen=false;
const raf=new Map(),frames=new Map();
const video={requestVideoFrameCallback(cb){const key=++id;frames.set(key,cb);return key;},cancelVideoFrameCallback(key){frames.delete(key);}};
const clock={request(cb){const key=++id;raf.set(key,cb);return key;},cancel(key){raf.delete(key);},now:()=>time};
const loop=createCameraFrameLoop({video:()=>video,frozen:()=>frozen,
  draw(mediaTime){draws++;if(throwFrame){throwFrame=false;throw Error('transient frame failure');}if(mediaTime!==undefined)assert.equal(mediaTime,1200);},onError(){errors++;}},clock);
const tick=()=>{time+=17;const pending=[...raf.values()];raf.clear();pending.forEach(cb=>cb(time));};
loop.start();loop.start();assert.equal(frames.size,1);assert.equal(raf.size,1);
const native=frames.values().next().value;frames.clear();native(time,{mediaTime:1.2});
assert.equal(draws,1);assert.equal(frames.size,1);assert.equal(raf.size,1);
// A hidden Safari video can advertise callbacks without ever delivering one.
tick();tick();assert.equal(draws,2,'animation watchdog must render instead of freezing');
assert.equal(frames.size,1);assert.equal(raf.size,1,'no callback queue growth');
native(time,{mediaTime:1.2});assert.equal(draws,2,'stale video callbacks are ignored');
throwFrame=true;tick();tick();assert.equal(errors,1);assert.equal(draws,3);
tick();tick();assert.equal(draws,4,'loop recovers after a thrown detector/material frame');
const late=frames.values().next().value;loop.stop();assert.equal(raf.size,0);assert.equal(frames.size,0);
late(time,{mediaTime:1.2});assert.equal(draws,4,'unmounted sessions cannot draw');
frozen=true;loop.start();assert.equal(frames.size,0);tick();assert.equal(draws,5);
loop.stop();assert.equal(raf.size,0);
console.log('PASS: one bounded mobile frame loop, video timestamps, stalled-callback fallback, exception recovery and session cleanup.');

// Native metadata can lag behind the image already drawn by the watchdog.
// Both paths must use the same video clock and advance the anchor once/image.
const times=[];let decoded=1;
video.currentTime=2;
video.getVideoPlaybackQuality=()=>({totalVideoFrames:decoded});
frozen=false;
const tracked=createCameraFrameLoop({video:()=>video,frozen:()=>frozen,draw:t=>times.push(Math.round(t)),onError:e=>{throw e;}},clock);
tracked.start();
let callback=frames.values().next().value;frames.clear();callback(time,{mediaTime:1.967});
assert.deepEqual(times,[2000]);
tick();tick();assert.equal(times.length,1,'watchdog must skip the same decoded image');
video.currentTime=2.034;decoded++;
tick();tick();assert.deepEqual(times,[2000,2034]);
callback=frames.values().next().value;frames.clear();callback(time,{mediaTime:2});
assert.equal(times.length,2,'late native metadata must not reset the lip anchor');
video.currentTime=2.067;decoded++;
callback=frames.values().next().value;frames.clear();callback(time,{mediaTime:2.034});
assert.deepEqual(times,[2000,2034,2067]);
tracked.stop();assert.equal(raf.size,0);assert.equal(frames.size,0);
console.log('PASS: lip tracking advances once per decoded image on a single camera clock.');
