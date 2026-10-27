import fs from 'node:fs/promises';
import { eventPassesGeo, isInDehradun } from '../ingest/lib/utils.mjs';
import { occurrencesOf } from '../src/lib/dates.mjs';

const events=JSON.parse(await fs.readFile('data/events.json','utf8'));
const errors=[];
const warnings=[];
const ids=new Set();
const outside=/\b(paris|france|dubai|london|singapore|delhi|gurugram|noida|mumbai|bengaluru|bangalore|pune|kolkata|chandigarh|haridwar|rishikesh|roorkee)\b/i;
const doon=/\b(dehradun|dehra dun|rajpur|dalanwala|jakhan|malsi|prem nagar|sahastradhara|raipur road|ballupur|doon)\b/i;

for(const [i,e] of events.entries()){
  for(const k of ['id','slug','title','startAt','venue','sources']) if(e[k]==null) errors.push(`[${i}] missing ${k}`);
  if(e.venue?.city!=='Dehradun') errors.push(`[${i}] invalid city ${e.venue?.city}`);
  if(ids.has(e.id)) errors.push(`[${i}] duplicate id ${e.id}`); ids.add(e.id);
  if(Number.isNaN(new Date(e.startAt).getTime())) errors.push(`[${i}] invalid startAt`);
  if(e.occurrences!==undefined && !occurrencesOf(e)) errors.push(`[${i}] invalid occurrences (needs two or more ascending timestamps in the form of startAt, the first equal to startAt): ${JSON.stringify(e.occurrences)}`);
  if(e.venue?.geo!==undefined && !isInDehradun(e.venue.geo)) errors.push(`[${i}] venue coordinates missing or far from Dehradun: ${JSON.stringify(e.venue.geo)}`);

  const semantic=`${e.title||''} ${e.description||''}`;
  if(outside.test(semantic) && !doon.test(semantic)) {
    errors.push(`[${i}] likely outside Dehradun: ${e.title}`);
  }
  // The location check the merge uses (foreign addresses, PIN codes outside Dehradun). The merge already
  // drops these, so one here means the data predates a rule change; the next refresh removes it.
  if(!eventPassesGeo(e)) warnings.push(`[${i}] fails the Dehradun location check and will be removed on the next refresh: ${e.title}`);

  if(!Array.isArray(e.sources) || e.sources.length===0) errors.push(`[${i}] has no source`);
  if(e.sources?.every(s=>s.provider==='allevents') && e.verificationStatus==='verified') {
    errors.push(`[${i}] AllEvents-only event must not be marked verified: ${e.title}`);
  }
}

// The hand-checked venue table: every entry needs a name, at least one phrase to match, coordinates near
// Dehradun and the page they were checked against.
let venues=[];
try { venues=JSON.parse(await fs.readFile('data/venues.json','utf8')); } catch(err) { if(err.code!=='ENOENT') errors.push(`data/venues.json: ${err.message}`); }
if(!Array.isArray(venues)) { errors.push('data/venues.json must be a list of venues'); venues=[]; }
for(const [i,v] of venues.entries()){
  if(!v || typeof v!=='object') { errors.push(`venues[${i}] is not a venue`); continue; }
  if(!v.name || !Array.isArray(v.match) || v.match.length===0) errors.push(`venues[${i}] needs a name and at least one match phrase`);
  if(!isInDehradun(v.geo)) errors.push(`venues[${i}] ${v.name}: coordinates missing or far from Dehradun`);
  if(!/^https:\/\//.test(v.source||'')) errors.push(`venues[${i}] ${v.name}: needs the https source the coordinates came from`);
}

if(warnings.length) console.warn(warnings.map(w=>`warning ${w}`).join('\n'));
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`validated ${events.length} events`);
