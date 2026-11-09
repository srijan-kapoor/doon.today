import {fetchText} from '../lib/http.mjs';
import {stripHtml,decodeEntities,categoryFromText,isDehradunText,stableId,slugify,nowIso,wordMatcher} from '../lib/utils.mjs';
const FEEDS=['https://www.reddit.com/r/Dehradun/new/.rss'];
const DAY_MS=24*3600_000;
// How far ahead of the post an event date may be: further out it's more likely a trip or a move than an event.
const MAX_DAYS_AHEAD=60;
function entries(xml){return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(m=>m[1]);}
function tag(s,name){const m=s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i')); return m?stripHtml(decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g,''))):''}
function href(s){const m=s.match(/<link[^>]+href=["']([^"']+)["']/i);return m?.[1]||''}
/** The first date the text names ("24th October", "Nov 1"), in the year that puts it on or after the post. */
export function explicitDate(text, postedAt=Date.now()){
  const months='Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const m=text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})(?:\\s+(20\\d{2}))?\\b`,'i')) || text.match(new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`,'i'));
  if(!m) return null;
  const monFirst=/^[A-Za-z]/.test(m[1]); const month=monFirst?m[1]:m[2]; const day=Number(monFirst?m[2]:m[1]);
  const at=(y)=>new Date(`${month} ${day}, ${y} 12:00:00 GMT+0530`);
  let d=at(Number(m[3]||new Date(postedAt).getUTCFullYear()));
  // "5 Jan" in a December post means next January.
  if(!m[3] && d.getTime()<postedAt-DAY_MS) d=at(d.getUTCFullYear()+1);
  return Number.isNaN(d.getTime())?null:d.toISOString();
}

// Whole words, so "trek" doesn't match "trekking".
const EVENT_WORDS=wordMatcher(['event','meetup','meet up','meet and greet','workshop','festival','fest','walk','run','marathon',
  'book club','book launch','book fair','screening','concert','open mic','exhibition','heritage','hike','trek','club','jam session',
  'quiz','game night','gig','tournament','comedy','stand up','show','talk','seminar','party','performance']);
// Posts asking for help, or about housing, jobs or services, are not events.
const REQUEST=/\b(looking for|suggest(?:ion)?s?|recommend(?:ation)?s?|help me (?:plan|find)|itinerary|any (?:leads|ideas|tips)|where (?:can|should) i)\b/i;
const NOT_EVENT=wordMatcher(['flat for rent','room for rent','pg','rent','1bhk','2bhk','3bhk','flatmate','hiring','job','vacancy','internship','for sale','selling','tuition']);
// Details only an event announcement has: a clock time, or a link to tickets or a sign-up form.
// "Tickets" alone doesn't count: people sell and ask for them too.
const STRONG=/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|forms\.gle|docs\.google\.com\/forms|bit\.ly|insider\.in|district\.in|bookmyshow\.com|allevents\.in|meetup\.com/i;

/**
 * Whether a post looks like an event in Dehradun: a date within 60 days of the post, Dehradun named, and an event
 * word. A request for help, or a post about housing, jobs or services, is skipped unless it also has a clock time
 * or a ticket or sign-up link. Returns { date, why } for a lead (why: what made it one), or { skip } saying why not.
 */
export function judgePost({title='', content='', postedAt=Date.now()}){
  const text=`${title} ${content}`;
  const date=explicitDate(text, postedAt);
  if(!date) return {skip:'no date'};
  const t=Date.parse(date);
  if(t<postedAt-DAY_MS || t>postedAt+MAX_DAYS_AHEAD*DAY_MS) return {skip:'date not within 60 days of the post'};
  if(!isDehradunText(text)) return {skip:'Dehradun not named'};
  const word=text.match(EVENT_WORDS)?.[0];
  if(!word) return {skip:'no event word'};
  const strong=text.match(STRONG)?.[0];
  const request=text.match(REQUEST)?.[0], other=text.match(NOT_EVENT)?.[0];
  if((request||other) && !strong) return {skip:request?`asks for help ("${request}")`:`about ${other}`};
  return {date, why:[`date ${date.slice(0,10)}`, `"${word.trim()}"`, ...(strong?[`"${strong.trim()}"`]:[])]};
}

export async function fetchReddit(){
  const candidates=[]; const checkedAt=nowIso(); const skipped={};
  for(const feed of FEEDS){const xml=await fetchText(feed); for(const raw of entries(xml)){
    const title=tag(raw,'title'), content=tag(raw,'content'), url=href(raw);
    const postedAt=Date.parse(tag(raw,'published')||tag(raw,'updated'))||Date.now();
    const verdict=judgePost({title,content,postedAt});
    if(verdict.skip){ skipped[verdict.skip]=(skipped[verdict.skip]||0)+1; continue; }
    const text=`${title} ${content}`;
    candidates.push({id:stableId('reddit',url,verdict.date),slug:slugify(title),title,description:content.slice(0,500),startAt:verdict.date,venue:{name:'See community post',city:'Dehradun'},categories:categoryFromText(text),pricing:{type:'unknown',currency:'INR'},sources:[{provider:'reddit',url,checkedAt,confidence:.5}],verificationStatus:'community-reported',curation:{status:'review',score:3},flaggedFor:verdict.why,firstSeenAt:checkedAt,lastSeenAt:checkedAt,lastCheckedAt:checkedAt});
  }}
  return {source:'reddit',events:[],reviewCandidates:candidates,diagnostics:{candidates:candidates.length,skipped}};
}
