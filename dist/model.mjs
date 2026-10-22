export const HOUR = 3600000, DAY = 24 * HOUR, OFFSET = 3 * HOUR;
export const timestamp = value => new Date(value).getTime();
export const dayKey = value => new Date(timestamp(value) + OFFSET).toISOString().slice(0, 10);
export const dayStart = day => timestamp(day + 'T00:00:00+03:00');
export const airportCodes = ['SVO', 'VKO', 'DME', 'ZIA'];

export function query(data, filters) {
  const start = Math.max(timestamp(data.meta.start), dayStart(filters.from));
  const end = Math.min(timestamp(data.meta.cutoff), dayStart(filters.to) + DAY);
  const airports = filters.airports;
  const segments = data.segments.filter(s => airports.includes(s.airport) && (filters.type === 'all' || s.status === filters.type))
    .map(s => ({...s, a: Math.max(timestamp(s.start), start), b: Math.min(timestamp(s.end || data.meta.cutoff), end)}))
    .filter(s => s.b > s.a);
  return {start, end, airports, segments};
}

export function unionDuration(intervals) {
  const sorted = intervals.map(x => [...x]).sort((a,b) => a[0]-b[0]);
  let total = 0, a = null, b = null;
  for (const [c,d] of sorted) {
    if (a === null) {a=c;b=d;}
    else if (c <= b) b = Math.max(b,d);
    else {total+=b-a;a=c;b=d;}
  }
  return total + (a === null ? 0 : b-a);
}

export function summarize(q) {
  const affected = new Set(), episodeLengths = new Map();
  let suspended=0,coordinated=0;
  for (const s of q.segments) {
    const length=s.b-s.a;
    if(s.status==='suspended') suspended+=length;else coordinated+=length;
    episodeLengths.set(s.episode_id,(episodeLengths.get(s.episode_id)||0)+length);
    for(let t=s.a;t<s.b;) {
      affected.add(dayKey(t));
      t=Math.min(s.b,dayStart(dayKey(t))+DAY);
    }
  }
  return {count:episodeLengths.size,total:suspended+coordinated,suspended,coordinated,
    days:affected.size,longest:Math.max(0,...episodeLengths.values()),
    anyAirport:unionDuration(q.segments.map(s=>[s.a,s.b]))};
}

export function calendar(q) {
  const rows=[];
  if(q.end<=q.start)return rows;
  for(let d=dayStart(dayKey(q.start));d<q.end;d+=DAY){
    const key=dayKey(d),a=Math.max(d,q.start),b=Math.min(d+DAY,q.end);
    const segments=q.segments.filter(s=>s.a<b&&s.b>a);
    const suspended=segments.filter(s=>s.status==='suspended').reduce((v,s)=>v+Math.min(b,s.b)-Math.max(a,s.a),0);
    const coordinated=segments.filter(s=>s.status==='coordinated').reduce((v,s)=>v+Math.min(b,s.b)-Math.max(a,s.a),0);
    rows.push({key,a,b,suspended,coordinated,total:suspended+coordinated,
      episodes:new Set(segments.map(s=>s.episode_id)).size,
      fraction:q.airports.length?(suspended+coordinated)/((b-a)*q.airports.length):0,partial:b-a<DAY});
  }
  return rows;
}

export function hourly(q) {
  const out=Array.from({length:24},(_,hour)=>({hour,suspended:0,coordinated:0,exposure:0,fraction:0}));
  if(q.end<=q.start)return out;
  for(let t=Math.floor((q.start+OFFSET)/HOUR)*HOUR-OFFSET;t<q.end;t+=HOUR){
    const a=Math.max(t,q.start),b=Math.min(t+HOUR,q.end),hour=new Date(t+OFFSET).getUTCHours();
    out[hour].exposure+=(b-a)*q.airports.length;
    for(const s of q.segments) if(s.a<b&&s.b>a)out[hour][s.status]+=Math.min(b,s.b)-Math.max(a,s.a);
  }
  return out.map(h=>({...h,fraction:h.exposure?(h.suspended+h.coordinated)/h.exposure:0}));
}

export function episodeRows(q,data) {
  const map=new Map(data.episodes.map(e=>[e.id,{...e,visible:[],duration:0}]));
  for(const s of q.segments){const e=map.get(s.episode_id);if(e){e.visible.push(s);e.duration+=s.b-s.a;}}
  return [...map.values()].filter(e=>e.visible.length).sort((a,b)=>timestamp(b.start)-timestamp(a.start));
}
