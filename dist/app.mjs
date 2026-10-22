import {query,summarize,calendar,hourly,episodeRows,timestamp,dayKey,dayStart,HOUR,DAY} from './model.mjs';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n);
const date=(v,opts={day:'numeric',month:'short'})=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',...opts}).format(new Date(v));
const clock=v=>date(v,{hour:'2-digit',minute:'2-digit'});
const duration=(ms,small=false)=>{const m=Math.round(ms/60000),h=Math.floor(m/60),r=m%60;return `${number(h)}${small?' <small>ч</small>':' ч'}${r?` ${r}${small?' <small>мин</small>':' мин'}`:''}`;};
const labels={suspended:'Приём и выпуск ограничены',coordinated:'По согласованию',open:'Ограничения сняты'};
const names={SVO:'Шереметьево',VKO:'Внуково',DME:'Домодедово',ZIA:'Жуковский'};
const defaults={from:'2026-09-23',to:'2026-10-23',airports:Object.keys(names),type:'all'};
let data,comparisonData,filters={...defaults,airports:[...defaults.airports]},q,days,focusDay='2026-10-22',page=0,journalPage=0;
const PAGE=8;
let eventMap;

function initFilters(restore=true){
 const p=new URLSearchParams(restore?location.search:'');
 const validDate=v=>/^2026-(09|10)-\d\d$/.test(v||'')&&v>=defaults.from&&v<=defaults.to&&Number.isFinite(dayStart(v))&&dayKey(dayStart(v))===v;
 if(validDate(p.get('from')))filters.from=p.get('from');
 if(validDate(p.get('to')))filters.to=p.get('to');
 if(p.has('airports'))filters.airports=p.get('airports').split(',').filter(a=>a in names);
 if(['all','suspended','coordinated'].includes(p.get('type')))filters.type=p.get('type');
 if(validDate(p.get('day')))focusDay=p.get('day');
 $('#date-from').value=filters.from;$('#date-to').value=filters.to;$('#type').value=filters.type;
 $('#airport-buttons').innerHTML=Object.keys(names).map(a=>`<button class="airport-toggle" data-airport="${a}" aria-pressed="${filters.airports.includes(a)}" title="${names[a]}">${a}</button>`).join('');
}
function saveState(){
 const p=new URLSearchParams({from:filters.from,to:filters.to,airports:filters.airports.join(','),type:filters.type,day:focusDay});
 history.replaceState(null,'',`${location.pathname}?${p}${location.hash||'#overview'}`);
}
function validate(){
 const ok=filters.from&&filters.to&&filters.from<=filters.to&&filters.from>=defaults.from&&filters.to<=defaults.to;
 $('#validation').hidden=!!ok;
 $('#validation').textContent=ok?'':'Выберите даты от 23 сентября до 23 октября. Начало периода должно быть не позже окончания.';
 return ok;
}
function render(){
 const valid=validate();
 q=valid?query(data,filters):{start:timestamp(data.meta.start),end:timestamp(data.meta.start),airports:filters.airports,segments:[]};
 days=calendar(q);
 if(days.length&&!days.some(d=>d.key===focusDay))focusDay=days.at(-1).key;
 $('#airport-buttons').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',filters.airports.includes(b.dataset.airport)));
 renderMetrics();renderCalendar();renderMonthCalendar();renderComparison();renderHourly();renderTimeline();renderEpisodes();renderJournal();renderObservations();saveState();
}
function renderMetrics(){
 const s=summarize(q);
 $('#metrics').innerHTML=[
  ['Эпизоды по аэропортам',number(s.count),'Переходы режимов внутри — один эпизод','↗','featured'],
  ['Время под ограничениями',duration(s.total,true),'Сумма по аэропортам, с пересечениями','◷',''],
  ['Дни с записями об ограничениях',number(s.days),'По восстановленным интервалам','▦',''],
  ['Самый долгий эпизод',duration(s.longest,true),'Длительность в выбранном периоде','↔','']
 ].map(([label,value,help,icon,cls])=>`<article class="metric ${cls}"><div class="metric-label">${label}<span aria-hidden="true">${icon}</span></div><div class="metric-value">${value}</div><p>${help}</p></article>`).join('');
}
function renderCalendar(){
 if(!days.length){$('#calendar-chart').innerHTML='<div class="empty">Нет дней в выбранном периоде</div>';return;}
 const max=Math.max(HOUR,...days.map(d=>d.total));
 $('#calendar-chart').innerHTML=days.map((d,i)=>{
   const h=Math.max(d.total?3:1,d.total/max*145),sus=d.total?d.suspended/d.total*100:0;
   const month=(i===0||d.key.endsWith('-01'))?date(d.a,{month:'short'}).toUpperCase():'';
   const text=`${date(d.a)}${d.partial?' — неполный день':''}: ${duration(d.total)}, ${d.episodes} эпизодов по аэропортам. Нажмите для шкалы дня.`;
   return `<button class="calendar-day ${focusDay===d.key?'selected':''} ${d.partial?'partial':''}" data-day="${d.key}" aria-label="${esc(text)}" aria-pressed="${focusDay===d.key}" title="${esc(text)}">${month?`<span class="month-flag">${month}</span>`:''}<span class="bar-value">${number(d.total/HOUR)} ч</span><span class="bar-stack" style="height:${h}px"><span class="suspended" style="height:${sus}%"></span><span class="coordinated" style="height:${d.total?100-sus:0}%"></span></span><span class="day-label">${d.key.slice(-2)}</span></button>`;
 }).join('');
 $('#calendar-note').textContent=`МАКСИМУМ ${number(max/HOUR)} Ч${days.some(d=>d.partial)?' · ШТРИХОВКА — НЕПОЛНЫЙ ДЕНЬ':''}`;
}
function renderComparison(){
 const summary=Object.keys(names).map(a=>({a,s:summarize({...q,segments:q.segments.filter(s=>s.airport===a)})}));
 const max=Math.max(HOUR,...summary.map(x=>x.s.total));
 $('#comparison').innerHTML=summary.map(({a,s})=>`<div class="airport-row ${filters.airports.includes(a)?'':'disabled'}"><div class="airport-row-top"><span class="airport-code">${a}</span><span>${names[a]}</span><span class="duration">${duration(s.total)}</span></div><div class="airport-bar"><span class="suspended" style="width:${s.suspended/max*100}%"></span><span class="coordinated" style="width:${s.coordinated/max*100}%"></span></div><div class="airport-row-bottom"><span>${filters.airports.includes(a)?`${s.count} эпизодов · ${s.days} дней с записями`:'Не выбран'}</span><span>${s.total?`${Math.round(s.suspended/s.total*100)}% времени — приём и выпуск ограничены`:'Нет интервалов в выборке'}</span></div></div>`).join('');
}
function renderMonthCalendar(){
 const columns=Object.keys(names);
 const head=`<div class="month-header"><div class="month-date-head">ДАТА / МСК</div>${columns.map(a=>`<div class="month-airport-head ${q.airports.includes(a)?'':'excluded'}"><div><span class="airport-code">${a}</span> ${names[a]}${q.airports.includes(a)?'':' <small>не выбран</small>'}</div><div class="month-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>`).join('')}</div>`;
 const rows=days.map((d,index)=>{
  const midnight=dayStart(d.key),weekday=date(midnight,{weekday:'short'}),weekend=['сб','вс'].includes(weekday);
  return (index===15?head:'')+`<div class="month-row ${weekend?'weekend':''} ${d.partial?'partial-row':''}"><button class="month-date" data-month-day="${d.key}" aria-label="${date(midnight)}: список участков всех аэропортов"><time datetime="${d.key}"><b>${date(midnight)}</b><small>${weekday.toUpperCase()}${d.partial?' · СРЕЗ':''}</small></time></button>${columns.map(a=>{
   const selected=q.airports.includes(a),segments=q.segments.filter(s=>s.airport===a&&s.a<d.b&&s.b>d.a);
   const bars=segments.map(s=>{
    const start=Math.max(s.a,d.a),end=Math.min(s.b,d.b),left=(start-midnight)/DAY*100,width=(end-start)/DAY*100;
    const from=clock(start),to=end===midnight+DAY?'24:00':clock(end);
    const text=`${date(midnight)}, ${names[a]}: ${from}–${to} МСК, ${labels[s.status]}, ${duration(end-start)}. Подробнее и источники.`;
    return `<button class="month-interval ${s.status}" style="left:${left}%;width:${width}%" data-episode="${s.episode_id}" aria-label="${esc(text)}" title="${esc(text)}">${width>=22?`<span>${from}–${to}</span>`:''}</button>`;
   }).join('');
   return `<div class="month-cell ${selected?'':'excluded'}"><div class="month-track">${bars}${d.partial?`<span class="censored-area" style="left:${(d.b-midnight)/DAY*100}%" title="После ${clock(d.b)} МСК — за пределами среза"></span>`:''}${!selected?'<span class="excluded-text">Не выбран</span>':''}</div></div>`;
  }).join('')}</div>`;
 }).join('');
 $('#month-calendar').innerHTML=head+(rows||'<div class="empty">Выберите корректный период</div>');
 $('#month-range').textContent=`${days.length} ДНЕЙ СРАЗУ · 4 АЭРОПОРТА · 24 ЧАСА В КАЖДОЙ ЯЧЕЙКЕ`;
}
function renderHourly(){
 const h=hourly(q),max=Math.max(.01,...h.map(x=>x.fraction));
 $('#hourly-chart').innerHTML=h.map(x=>{
  const value=number(x.fraction*100),sus=x.suspended+x.coordinated?x.suspended/(x.suspended+x.coordinated)*100:0;
  const text=`${String(x.hour).padStart(2,'0')}:00–${String(x.hour+1).padStart(2,'0')}:00 МСК: `+(x.exposure?`${value}% наблюдаемого аэропорто-времени под ограничениями`:'нет наблюдаемого времени в выборке; после среза данных нет');
  const fill=x.suspended+x.coordinated?`<span class="suspended" style="height:${sus}%"></span><span class="coordinated" style="height:${100-sus}%"></span>`:'';
  return `<button class="hour-column" style="height:${Math.max(2,x.fraction/max*85)}%" data-hour="${x.hour}" title="${esc(text)}" aria-label="${esc(text)}">${fill}</button>`;
 }).join('');
}
function renderTimeline(){
 const d=days.find(d=>d.key===focusDay);
 $('#timeline-title').textContent=d?date(d.a,{day:'numeric',month:'long',year:'numeric'})+(d.partial?' · неполный день':''):'Выберите период';
 $('#prev-day').disabled=!d||days.indexOf(d)<=0;$('#next-day').disabled=!d||days.indexOf(d)>=days.length-1;
 if(!d||!q.airports.length){$('#timeline').innerHTML='<div class="empty">Выберите хотя бы один аэропорт и корректный период</div>';return;}
 const midnight=dayStart(d.key);
 $('#timeline').innerHTML='<div class="time-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>'+q.airports.map(a=>{
  const seg=q.segments.filter(s=>s.airport===a&&s.a<d.b&&s.b>d.a);
  const bars=seg.map(s=>{
   const left=(Math.max(s.a,d.a)-midnight)/DAY*100,width=(Math.min(s.b,d.b)-Math.max(s.a,d.a))/DAY*100;
   const text=`${names[a]}: ${labels[s.status]}, ${clock(Math.max(s.a,d.a))}–${Math.min(s.b,d.b)===midnight+DAY?'24:00':clock(Math.min(s.b,d.b))}. Подробнее об эпизоде`;
   return `<button class="timeline-interval ${s.status}" style="left:${left}%;width:${width}%" data-episode="${s.episode_id}" title="${esc(text)}" aria-label="${esc(text)}"></button>`;
  }).join('');
  return `<div class="timeline-row"><span class="timeline-airport"><span class="airport-code">${a}</span>${names[a]}</span><div class="timeline-track">${bars}${d.partial?`<span class="censored-area" style="left:${(d.b-midnight)/DAY*100}%" title="После момента среза данных нет"></span>`:''}</div></div>`;
 }).join('');
}
function tag(status){return `<span class="regime-tag ${status}">${status==='coordinated'?'По согласованию':status==='open'?'Сняты':'Приём / выпуск'}</span>`;}
function renderEpisodes(){
 const rows=episodeRows(q,data);page=Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE)-1));
 $('#episode-description').textContent=`${rows.length} эпизодов в выборке. Один эпизод может включать несколько режимов.`;
 if(!rows.length){$('#episodes').innerHTML='<div class="empty">Нет восстановленных эпизодов по этим фильтрам. Это не подтверждение отсутствия ограничений.</div>';return;}
 $('#episodes').innerHTML=`<div class="table-scroll"><table><thead><tr><th>АЭРОПОРТ</th><th>НАЧАЛО ЭПИЗОДА, МСК</th><th>РЕЖИМЫ В ВЫБОРКЕ</th><th>ВРЕМЯ В ВЫБОРКЕ</th><th>ИСТОЧНИК</th><th></th></tr></thead><tbody>${rows.slice(page*PAGE,(page+1)*PAGE).map(e=>`<tr><td><span class="airport-code">${e.airport}</span></td><td>${date(e.start)}<span class="time-detail">${clock(e.start)}</span>${timestamp(e.start)<q.start?' <span title="Начало раньше выбранного периода">↤</span>':''}</td><td><div class="regime-tags">${[...new Set(e.visible.map(s=>s.status))].map(tag).join('')}</div></td><td>${duration(e.duration)}</td><td><a href="${esc(eventMap.get(e.start_event)?.url)}" class="source-link" target="_blank" rel="noopener noreferrer">Росавиация ↗</a></td><td><button class="row-button" data-episode="${e.id}" aria-label="Подробности эпизода ${e.airport}, ${date(e.start)}">↗</button></td></tr>`).join('')}</tbody></table></div>${pagination('episodes',page,rows.length)}`;
}
function pagination(kind,p,total){const max=Math.ceil(total/PAGE);return `<div class="table-pagination"><span>${p*PAGE+1}–${Math.min((p+1)*PAGE,total)} из ${total}</span><div><button data-page="${kind}" data-delta="-1" ${p===0?'disabled':''} aria-label="Предыдущая страница">←</button><span>${p+1} / ${max}</span><button data-page="${kind}" data-delta="1" ${p>=max-1?'disabled':''} aria-label="Следующая страница">→</button></div></div>`;}
function renderJournal(){
 const search=($('#search').value||'').trim().toLowerCase();
 const rows=data.events.filter(e=>q.airports.includes(e.airport)&&timestamp(e.at)>=q.start&&timestamp(e.at)<q.end&&(filters.type==='all'||e.status===filters.type))
  .filter(e=>`${e.airport} ${names[e.airport]} ${e.at} ${labels[e.status]} ${e.excerpt}`.toLowerCase().includes(search)).sort((a,b)=>timestamp(b.at)-timestamp(a.at));
 journalPage=Math.min(journalPage,Math.max(0,Math.ceil(rows.length/PAGE)-1));
 if(!rows.length){$('#journal').innerHTML='<div class="empty">Нет публикаций по выбранным фильтрам и поиску</div>';return;}
 $('#journal').innerHTML=`<div class="table-scroll"><table><thead><tr><th>ПУБЛИКАЦИЯ, МСК</th><th>АЭРОПОРТ</th><th>ОБЪЯВЛЕННЫЙ РЕЖИМ</th><th>ПЕРВОИСТОЧНИК</th></tr></thead><tbody>${rows.slice(journalPage*PAGE,(journalPage+1)*PAGE).map(e=>`<tr><td>${date(e.at)}<span class="time-detail">${clock(e.at)}</span></td><td><span class="airport-code">${e.airport}</span> ${names[e.airport]}</td><td>${tag(e.status)}</td><td><a class="source-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.post_id)} ↗</a></td></tr>`).join('')}</tbody></table></div>${pagination('journal',journalPage,rows.length)}`;
}
const observationDescription={
 'favt_info/8518':'8 октября: сводка сообщает о работе Жуковского по согласованию. Отдельный момент перехода не установлен.',
 'favt_info/8771':'16 октября: сводка сообщает о 106 задержанных рейсах московского авиаузла на 16:00. Это последствия, а не новый интервал ограничений.',
 'favt_info/8797':'17 октября: в сводке говорится о работе всех московских аэропортов по согласованию. Начало и окончание этого режима не установлены.'
};
function renderObservations(){
 const obs=data.observations.filter(o=>o.airports.some(a=>q.airports.includes(a))&&timestamp(o.published_at)>=q.start&&timestamp(o.published_at)<q.end);
 const html=`<h3>За пределами точных интервалов${obs.length?` · ${obs.length} наблюдения`:''}</h3><p>Некоторые сводки сообщают о режиме или последствиях без однозначных границ. Они сохранены отдельно и не добавляют часы к графикам. Этот блок показывает контекст всех режимов независимо от фильтра типа.</p>${obs.length?obs.map(o=>`<article class="observation"><time datetime="${o.published_at}">${date(o.published_at)} · ${clock(o.published_at)}</time><p>${esc(observationDescription[o.id]||o.reason)}</p><a class="source-link" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Сообщение ↗</a></article>`).join(''):'<p>Для выбранных дат и аэропортов нет отдельных непарных наблюдений.</p>'}`;
 $('#observations').innerHTML=html;$('#journal-observations').innerHTML=html;$('#calendar-observations').innerHTML=html;
}
function renderSources(){
 const official=data.airport_reports.filter(x=>x.provenance==='official'),candidates=data.airport_reports.filter(x=>x.provenance==='candidate');
 $('#source-content').innerHTML=`
 <section class="panel source-banner"><div class="eyebrow">ПРОЗРАЧНОСТЬ ИССЛЕДОВАНИЯ</div><h2>Проверить можно каждую цифру.</h2><p>Архив собран один раз из открытых источников. Основные расчёты опираются только на типовые объявления Росавиации. Сообщения аэропортов и нетиповые сводки помогают увидеть ограничения метода.</p></section>
 <div class="source-grid"><section class="panel source-card"><div class="eyebrow">ОСНОВНОЙ АРХИВ</div><div class="source-number">${data.meta.archive_messages}<small>уникальных сообщений всего канала</small></div><p>${data.meta.archive_pages} страницы публичного архива с запасом до начала периода. За исследуемый период — ${data.meta.moscow_source_messages} сообщения, относящихся к московским аэропортам. Одно сообщение может относиться сразу к нескольким аэропортам.</p><a href="https://t.me/s/favt_info" target="_blank" rel="noopener noreferrer">Говорит Росавиация ↗</a></section>
 <section class="panel source-card"><div class="eyebrow">РЕЗУЛЬТАТ РАЗБОРА</div><div class="source-number">${data.episodes.length}<small>эпизодов по четырём аэропортам</small></div><p>${data.segments.length} участков режимов, ${data.events.length} записей переходов по аэропортам, ${data.observations.length} непарные контекстные сводки. Один эпизод DME начался до границы периода; в сумме учитывается только пересечение с выбранными датами.</p><a href="data/collection-manifest.json" download>URL страниц и контрольные суммы SHA-256 ↓</a></section></div>
 <section class="panel"><div class="section-head"><div><div class="eyebrow">ПРАВИЛА РАСЧЁТА</div><h2>Что именно измеряется</h2></div></div><ol class="method-list">
 <li><strong>Эпизод относится к одному аэропорту.</strong> Он начинается с объявления ограничений или работы по согласованию и заканчивается сообщением о снятии. Смена режима внутри — один эпизод. Событие для четырёх аэропортов может дать четыре эпизода.</li>
 <li><strong>Длительность — между публикациями.</strong> UTC из Telegram переводится в МСК. Указанное в тексте фактическое время сохраняется в дополнительных материалах, но не подменяет выборочно границы основного ряда. Погрешность публикации не измерена.</li>
 <li><strong>Два режима считаются отдельно.</strong> «Приём и выпуск ограничены» — типовое объявление Росавиации о введении ограничений; «по согласованию» — приём и отправка рейсов по согласованию с органами. Эти часы нельзя одинаково трактовать как полное закрытие. «Ковёр» и воздушная тревога отмечаются только в исходных сообщениях аэропортов.</li>
 <li><strong>Аэропорто-часы складываются.</strong> Один час одновременных ограничений четырёх аэропортов — четыре аэропорто-часа. Внутри аэропорта повторные объявления одного режима не создают пересечений. Даты обрезают интервалы, эпизод считается, если хотя бы один его участок попал в выборку.</li>
 <li><strong>График по часам учитывает экспозицию.</strong> Числитель — минуты ограничений в каждом часе суток; знаменатель — доступные минуты выбранных аэропортов в этом часу за выбранные даты. Неполный последний день учитывается только до 00:51. Это доля исторического времени, не вероятность задержки.</li>
 <li><strong>Пробелы остаются пробелами.</strong> Нет сообщения — нет доказательства обычного режима. Сводки без границ видны в разделе наблюдений, но не образуют синтетические интервалы. Удалённые или не опубликованные события могли не попасть в архив.</li>
 <li><strong>Причины и последствия не смешиваются.</strong> Причина БПЛА не присваивается автоматически по формулировке «безопасность полётов». Региональные SMS РСЧС не собраны: общедоступный полный архив не установлен. Полной истории задержек/отмен отдельных рейсов в наборе нет.</li>
 </ol></section>
 <section class="panel source-card"><div class="eyebrow">ДОПОЛНИТЕЛЬНАЯ СВЕРКА</div><h2>Объявления самих аэропортов</h2><p>${official.length} сообщений из подтверждённых каналов Шереметьево и Домодедово. Каналы связаны с официальными сайтами. Для Внуково отдельно сохранено ${candidates.length} сообщений канала, заявляющего официальный статус; обратная ссылка с сайта не проверена из-за защиты. Эти сообщения не определяют границы расчётов. У подтверждённого канала Жуковского последняя доступная публикация — 21 сентября, данных за период нет.</p>
 <div class="source-sample"><p><strong>Разные времена публикации.</strong> Снятие ограничений SVO 22 октября опубликовано аэропортом в 05:14, Росавиацией — в 05:19 МСК. Это не две разные отмены ограничения.</p><a class="source-link" href="https://t.me/svo_online/7376" target="_blank" rel="noopener noreferrer">Шереметьево 7376 ↗</a> · <a class="source-link" href="https://t.me/favt_info/8872" target="_blank" rel="noopener noreferrer">Росавиация 8872 ↗</a></div>
 <div class="source-sample"><p><strong>Расхождение источников.</strong> Сообщение DME 22 октября указывает введение ограничений с 00:45, а публикация Росавиации об ограничениях датирована 00:38 МСК. В основном ряду оставлено время публикации Росавиации; фактическая граница не объявляется установленной.</p><a class="source-link" href="https://t.me/dmepress/3962" target="_blank" rel="noopener noreferrer">Домодедово 3962 ↗</a> · <a class="source-link" href="https://t.me/favt_info/8867" target="_blank" rel="noopener noreferrer">Росавиация 8867 ↗</a></div>
 <p>Частичное снятие ограничений в объявлениях DME 9 и 12 октября не считается обычным режимом. Дополнительные сообщения показываются рядом с эпизодом для чтения; близость по времени не означает автоматическое подтверждение всех границ.</p><div class="downloads"><a class="button secondary" href="https://www.svo.aero/" target="_blank" rel="noopener noreferrer">Сайт SVO ↗</a><a class="button secondary" href="https://www.dme.ru/" target="_blank" rel="noopener noreferrer">Сайт DME ↗</a><a class="button secondary" href="https://www.zia.aero/" target="_blank" rel="noopener noreferrer">Сайт ZIA ↗</a><a class="button secondary" href="https://www.vnukovo.ru/" target="_blank" rel="noopener noreferrer">Сайт VKO ↗</a></div></section>
 <section class="panel source-card"><div class="eyebrow">ОТКРЫТЫЙ НАБОР</div><h2>Данные можно забрать с собой</h2><p>В JSON сохранены события, интервалы, эпизоды, наблюдения, дополнительные сообщения аэропортов и ограничения метода. CSV содержит все восстановленные интервалы. Экспорт на странице обзора и календаря учитывает текущие фильтры.</p><div class="downloads"><a class="button" href="data/dataset.json" download>Весь набор JSON ↓</a><a class="button secondary" href="data/intervals.csv" download>Все интервалы CSV ↓</a><a class="button secondary" href="data/source-messages.json" download>Московские сообщения JSON ↓</a><a class="button secondary" href="data/collection-manifest.json" download>Манифест сбора ↓</a></div></section>`;
}
function renderAudit(){
 if(!comparisonData){$('#comparison-content').innerHTML='<section class="panel"><h2>Сравнительный набор не загрузился</h2><p>Обновите страницу или <a href="data/comparison.json">откройте JSON сверки</a>.</p></section>';return;}
 const c=comparisonData,a=c.airports_ru,m=c.msk_airports,b=c.benzinmap;
 $('#comparison-content').innerHTML=`
 <section class="panel source-banner"><div class="eyebrow">СВЕРКА СНИМКОВ / 23 ОКТЯБРЯ 2026</div><h2>Одинаковые цифры ещё не означают одинаковые данные.</h2><p>Сравнены конкретные переходы, окончания и исходные сообщения. Период этой проверки фиксирован: 23 сентября — 23 октября, 00:51 МСК. Фильтры других разделов его не меняют. Три агрегатора аэропортов используют ту же Росавиацию — это проверка обработки, а не независимое подтверждение полной реальной истории.</p></section>
 <div class="source-grid"><section class="panel source-card"><div class="eyebrow">MSK-AIRPORTS.RU / СОШЛОСЬ</div><div class="source-number">${m.exact_event_matches}/${m.event_count}<small>показанных переходов</small></div><p>Совпали аэропорт, режим и точное время публикации. Доступный журнал — часть месяца, с 9 по 22 октября. Счётчики новых эпизодов сходятся по всем четырём аэропортам после выравнивания определения.</p><a href="${m.url}" target="_blank" rel="noopener noreferrer">Открыть журнал ↗</a></section>
 <section class="panel source-card"><div class="eyebrow">AIRPORTS.RU / ЧАСТИЧНО СХОДИТСЯ</div><div class="source-number">${a.matching_both_boundaries}/${a.ours_segments}<small>участков по обеим границам</small></div><p>${number(a.agreement_percent_of_our_segments)}% наших участков имеют совпадающий аэропорт, режим и границы с допуском менее минуты. В месячных CSV нет соответствия для ${a.missing_in_csv.length} участков; у ${a.different_endings.length} отличается окончание. Это согласие рядов, не процент достоверности.</p><a href="${a.url}" target="_blank" rel="noopener noreferrer">Открыть историю ↗</a></section>
 <section class="panel source-card"><div class="eyebrow">BENZINMAP / СУЩЕСТВЕННЫЕ РАСХОЖДЕНИЯ</div><div class="source-number">8<small>ошибочных или необоснованных присвоений</small></div><p>197 присвоений «аэропорт + исходный пост + режим» совпали. Ещё 8 отнесены к аэропорту вопреки содержанию или области действия сообщения; 2 — допустимые наблюдения без установленных границ. Это не метрика совпадения интервалов.</p><a href="${b.url}" target="_blank" rel="noopener noreferrer">Открыть агрегатор ↗</a></section>
 <section class="panel source-card"><div class="eyebrow">РСЧС И РЕГИОНАЛЬНЫЕ ЛЕНТЫ / ДРУГОЙ ПОКАЗАТЕЛЬ</div><div class="source-number">41<small>период опасности в регионе</small></div><p>На страницах SVO и VKO «Радар Онлайн» это одна региональная метрика, а не ограничения аэропортов. Сбор начат 30 сентября. Полный сопоставимый месячный архив SMS РСЧС не получен; процент совпадения не вычисляется.</p><a href="https://karta-bpla.ru/aeroporty/sheremetevo/" target="_blank" rel="noopener noreferrer">Что считает Радар Онлайн ↗</a></section></div>
 <section class="panel source-card"><div class="eyebrow">НЕБОЛЬШОЕ РАСХОЖДЕНИЕ / ГРАНИЦА ПЕРИОДА</div><h2>Почему у DME 31 эпизод, а у соседнего сайта 30</h2><p>Один эпизод начался 22 сентября в 23:55, а закончился 23 сентября в 01:59. У нас его часть внутри месяца видна в календаре. При сравнении только новых начал у нас тоже 30 эпизодов и 115,29 часа; msk-airports.ru показывает 30 и 115 целых часов. Это различие определения, не потерянный эпизод.</p><div class="table-scroll"><table><thead><tr><th>АЭРОПОРТ</th><th>У НАС ПЕРЕСЕКАЮТ ПЕРИОД</th><th>У САЙТА</th><th>У НАС ТОЛЬКО НОВЫЕ НАЧАЛА</th></tr></thead><tbody>${Object.keys(names).map(code=>`<tr><td>${code}</td><td>${m.stats[code].ours_intersecting_episodes}</td><td>${m.stats[code].site_episode_count}</td><td>${m.stats[code].ours_starts_in_period}</td></tr>`).join('')}</tbody></table></div></section>
 <section class="panel source-card"><div class="eyebrow">ЧТО ВЛИЯЕТ НА ВЫВОДЫ</div><h2>Разница в минуты и разница в смысл</h2>
 <details class="audit-case" open><summary><span class="audit-severity">ВЫСОКАЯ</span>Ограничение приписано другому аэропорту</summary><p>Пост 8422 объявляет согласование для VKO и DME. Жуковский упоминается лишь в ссылке на табло, но BenzinMap формирует для него период с 4 октября 22:37 до 6 октября 05:14. В посте 8518 согласование относится к ZIA, а SVO/VKO/DME прямо названы открытыми; агрегатор присваивает согласование и им.</p><a class="source-link" href="https://t.me/favt_info/8422" target="_blank" rel="noopener noreferrer">Первичный пост 8422 ↗</a> · <a class="source-link" href="https://t.me/favt_info/8518" target="_blank" rel="noopener noreferrer">Пост 8518 ↗</a> · <a class="source-link" href="https://benzinmap.ru/airports/zia/" target="_blank" rel="noopener noreferrer">Снимок показателя ZIA на сайте ↗</a></details>
 <details class="audit-case"><summary><span class="audit-severity">ВЫСОКАЯ</span>Несколько периодов соединены в длинный</summary><p>Для VKO и DME 5 октября CSV Airports.ru ведёт согласование с 03:08 до 6 октября 01:53. Между тем пост 8427 снимает ограничения 5 октября в 04:22. Разница окончания около 21 ч 31 мин на аэропорт. Для SVO 9 октября CSV пропускает снятие в 17:34 и ведёт участок до 23:15.</p><a class="source-link" href="https://t.me/favt_info/8427" target="_blank" rel="noopener noreferrer">Снятие 5 октября ↗</a> · <a class="source-link" href="https://t.me/favt_info/8558" target="_blank" rel="noopener noreferrer">Снятие SVO 9 октября ↗</a></details>
 <details class="audit-case"><summary><span class="audit-severity">ВЫСОКАЯ ДЛЯ ТИПА</span>Смена режима теряется внутри эпизода</summary><p>VKO 13 октября: ограничения приёма/выпуска 02:07–03:12, затем работа по согласованию до 10:59. CSV оставляет первый режим до 10:59. Длина общего эпизода может совпасть, а вывод о времени прекращения приёма и выпуска — измениться.</p><a class="source-link" href="https://t.me/favt_info/8637" target="_blank" rel="noopener noreferrer">Объявление смены режима ↗</a></details>
 <details class="audit-case"><summary><span class="audit-severity">НЕУСТАНОВЛЕННАЯ НЕПРЕРЫВНОСТЬ</span>85 часов из одной непарной сводки</summary><p>BenzinMap соединяет сводку о SVO 17 октября 17:10 со снятием 21 октября 06:10. Источник подтверждает наблюдавшийся режим, но не доказывает его непрерывность все 85 часов. У нас это видимое отдельное наблюдение без придуманной длительности.</p><a class="source-link" href="https://t.me/favt_info/8797" target="_blank" rel="noopener noreferrer">Непарная сводка ↗</a> · <a class="source-link" href="https://benzinmap.ru/airports/svo/" target="_blank" rel="noopener noreferrer">Таблица SVO у агрегатора ↗</a></details>
 <details class="audit-case"><summary><span class="audit-severity neutral">НЕСОПОСТАВИМО</span>Региональная опасность вместо режима аэропорта</summary><p>41 период / 238,3 часа на страницах SVO и VKO у Радар Онлайн — тревоги одного региона. Сайт прямо пишет, что это не данные Росавиации. Отбой опасности в 08:20 или 09:07 не противоречит снятию аэропортовых ограничений в 05:19: это разные события. Заменять одно другим нельзя.</p><a class="source-link" href="https://karta-bpla.ru/aeroporty/sheremetevo/" target="_blank" rel="noopener noreferrer">Показатель и пояснение источника ↗</a></details></section>
 <section class="panel source-card"><div class="eyebrow">РЕЗУЛЬТАТ АУДИТА</div><h2>Основной ряд сохранён. Границы знания — тоже.</h2><p>Сверка не дала оснований заменять наши 98 эпизодов и 130 участков внешними агрегатами. Добавлены причины расхождений, исходные ссылки и воспроизводимая таблица проверки. Это не доказывает полноту нашего архива: не опубликованные события и неизвестные границы остаются неизвестными.</p><div class="downloads"><a class="button" href="data/comparison.json" download>Полная сверка JSON ↓</a><a class="button secondary" href="data/comparison-report.md" download>Подробный отчёт ↓</a><a class="button secondary" href="data/rschs-audit.md" download>Разбор РСЧС и тревог ↓</a><a class="button secondary" href="data/evidence.zip" download>Открытые исходные снимки ZIP ↓</a></div></section>`;
}
function openEpisode(id){
 const e=data.episodes.find(x=>x.id===id);if(!e)return;
 const segments=data.segments.filter(s=>s.episode_id===id);
 const visible=q.segments.filter(s=>s.episode_id===id);
 const fullDuration=segments.reduce((n,s)=>n+timestamp(s.clipped_end)-timestamp(s.clipped_start),0);
 const reports=data.airport_reports.filter(r=>r.airport===e.airport&&timestamp(r.published_at)>=timestamp(e.start)-30*60000&&timestamp(r.published_at)<=timestamp(e.end||data.meta.cutoff)+30*60000);
 $('#detail-content').innerHTML=`<div class="detail-header"><div class="eyebrow">${e.airport} / ПОДРОБНОСТИ ЭПИЗОДА</div><h2>${names[e.airport]}<br>${date(e.start,{day:'numeric',month:'long'})}</h2><p class="muted">${date(e.start)} ${clock(e.start)} — ${e.end?date(e.end)+' '+clock(e.end):'снятие не найдено'} МСК</p></div>
 <div class="detail-stats"><div><small>В месячном срезе</small>${duration(fullDuration)}</div><div><small>В текущей выборке</small>${duration(visible.reduce((n,s)=>n+s.b-s.a,0))}</div></div>
 <p class="detail-caveat">Границы основаны на времени публикаций Росавиации. Они не устанавливают точное операционное время. ${timestamp(e.start)<timestamp(data.meta.start)?'Эпизод начался до начала месяца; в суммах учтено только пересечение.':''}</p>
 ${segments.map(s=>`<div class="detail-segment">${tag(s.status)}<p>${date(s.start)} ${clock(s.start)} — ${s.end?date(s.end)+' '+clock(s.end):'окончание неизвестно'} МСК</p><a class="source-link" href="${esc(eventMap.get(s.start_event)?.url)}" target="_blank" rel="noopener noreferrer">Объявление режима ↗</a>${s.end_event?`<a class="source-link" href="${esc(eventMap.get(s.end_event)?.url)}" target="_blank" rel="noopener noreferrer">Следующий переход ↗</a>`:''}</div>`).join('')}
 <h3>Сообщения аэропорта рядом с эпизодом</h3><p class="muted" style="font-size:10px">В пределах эпизода и 30 минут от границ. Это дополнительные материалы, а не автоматическое подтверждение интервала.</p>
 ${reports.length?reports.map(r=>`<article class="airport-report"><b>${date(r.published_at)} · ${clock(r.published_at)} МСК</b>${r.provenance==='candidate'?'<div class="candidate-label">Канал заявляет официальный статус; связь с сайтом не проверена</div>':''}<p>${esc(r.text)}</p><a class="source-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Исходное сообщение ↗</a></article>`).join(''):'<p class="muted" style="font-size:11px">В собранных дополнительных источниках рядом с этим эпизодом сообщений нет.</p>'}`;
 if(!$('#detail').open)$('#detail').showModal();
}
function openDay(key){
 const d=days.find(d=>d.key===key);if(!d)return;
 const midnight=dayStart(key);
 $('#detail-content').innerHTML=`<div class="detail-header"><div class="eyebrow">ОБЩИЙ КАЛЕНДАРЬ / ВСЕ АЭРОПОРТЫ</div><h2>${date(midnight,{day:'numeric',month:'long',year:'numeric'})}</h2></div><p class="detail-caveat">Участки текущей выборки. Время московское, по публикациям. ${d.partial?'После 00:51 МСК данных в срезе нет.':''}</p>`+Object.keys(names).map(a=>{
  const selected=q.airports.includes(a),ss=q.segments.filter(s=>s.airport===a&&s.a<d.b&&s.b>d.a);
  return `<section class="detail-segment"><h3><span class="airport-code">${a}</span> ${names[a]}</h3>${!selected?'<p class="muted">Аэропорт исключён фильтром</p>':!ss.length?'<p class="muted">Нет интервалов в текущей выборке</p>':ss.map(s=>{const from=Math.max(s.a,d.a),to=Math.min(s.b,d.b);return `<div class="day-detail-item"><span>${clock(from)}–${to===midnight+DAY?'24:00':clock(to)} · ${duration(to-from)}</span>${tag(s.status)}<button class="button secondary" data-episode="${s.episode_id}">Эпизод и источники ↗</button></div>`;}).join('')}</section>`;
 }).join('');
 if(!$('#detail').open)$('#detail').showModal();
}
function csvExport(){
 const headers=['airport','status','start_msk','end_msk','selected_minutes','episode_id','start_source','end_source'];
 const rows=q.segments.map(s=>[s.airport,s.status,new Date(s.a+3*HOUR).toISOString().replace('Z','+03:00'),new Date(s.b+3*HOUR).toISOString().replace('Z','+03:00'),((s.b-s.a)/60000).toFixed(3),s.episode_id,eventMap.get(s.start_event)?.url,eventMap.get(s.end_event)?.url||'']);
 const csv='\uFEFF'+[headers,...rows].map(row=>row.map(c=>'"'+String(c??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
 const a=document.createElement('a');a.href=url;a.download=`moscow-airspace-${filters.from}-${filters.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast(`Экспортировано участков: ${rows.length}. Даты и режим учитывают фильтры.`);
}
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function setView(){
 const view=['overview','calendar','journal','sources','comparison'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
 $('#main').dataset.view=view;
 document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==view+'-view');
 document.querySelectorAll('.nav-link').forEach(e=>{e.classList.toggle('active',e.dataset.view===view);if(e.dataset.view===view)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
 $('#page-title').innerHTML=view==='overview'?'Когда небо<br>меняет планы<span>.</span>':view==='calendar'?'Весь месяц.<br> Час за часом<span>.</span>':view==='journal'?'История<br>каждого перехода<span>.</span>':view==='comparison'?'Сходится?<br> Проверим<span>.</span>':'Данные, которым<br>видны границы<span>.</span>';
 $('#page-subtitle').textContent=view==='overview'?'Месяц работы московских аэропортов — в событиях, часах ограничений и проверяемых источниках.':view==='calendar'?'Все четыре аэропорта на одном календаре. Видно, где и когда менялись режимы — каждый день от 00:00 до 24:00.':view==='journal'?'Хронология объявлений Росавиации. Время московское; каждое событие ведёт к первоисточнику.':view==='comparison'?'Сопоставление с другими сайтами: что совпало, где разошлось и насколько это меняет выводы.':'Как собран архив, что означают показатели и какие вопросы остаются открытыми.';
 $('.filters').hidden=['sources','comparison'].includes(view);
}
document.addEventListener('click',e=>{
 const airport=e.target.closest('[data-airport]');if(airport){const a=airport.dataset.airport;filters.airports=filters.airports.includes(a)?filters.airports.filter(x=>x!==a):Object.keys(names).filter(x=>filters.airports.includes(x)||x===a);page=journalPage=0;render();return;}
 const day=e.target.closest('[data-day]');if(day){focusDay=day.dataset.day;renderCalendar();renderTimeline();saveState();return;}
 const monthDay=e.target.closest('[data-month-day]');if(monthDay){openDay(monthDay.dataset.monthDay);return;}
 const episode=e.target.closest('[data-episode]');if(episode){openEpisode(episode.dataset.episode);return;}
 const paging=e.target.closest('[data-page]');if(paging){if(paging.dataset.page==='episodes'){page+=Number(paging.dataset.delta);renderEpisodes();}else{journalPage+=Number(paging.dataset.delta);renderJournal();}return;}
 const hour=e.target.closest('[data-hour]');if(hour){const x=hourly(q)[Number(hour.dataset.hour)];toast(`${String(x.hour).padStart(2,'0')}:00 МСК · `+(x.exposure?`${number(x.fraction*100)}% наблюдаемого времени под ограничениями`:'нет наблюдаемого времени в выборке'));}
});
['date-from','date-to','type'].forEach(id=>$('#'+id).addEventListener('change',()=>{filters={...filters,from:$('#date-from').value,to:$('#date-to').value,type:$('#type').value};page=journalPage=0;render();}));
$('#reset').addEventListener('click',()=>{filters={...defaults,airports:[...defaults.airports]};focusDay='2026-10-22';initFilters(false);page=journalPage=0;render();});
$('#search').addEventListener('input',()=>{journalPage=0;renderJournal();});
$('#export-filtered').addEventListener('click',csvExport);
$('#export-calendar').addEventListener('click',csvExport);
$('#close-detail').addEventListener('click',()=>$('#detail').close());
$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){const r=$('#detail').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#detail').close();}});
for(const [id,delta] of [['prev-day',-1],['next-day',1]])$('#'+id).addEventListener('click',()=>{const i=days.findIndex(d=>d.key===focusDay);if(days[i+delta]){focusDay=days[i+delta].key;renderCalendar();renderTimeline();saveState();}});
window.addEventListener('hashchange',setView);
try{
 const response=await fetch('data/dataset.json');if(!response.ok)throw new Error(`HTTP ${response.status}`);data=await response.json();
 try{const audit=await fetch('data/comparison.json');if(audit.ok)comparisonData=await audit.json();}catch{}
 eventMap=new Map(data.events.map(e=>[e.id,e]));initFilters();renderSources();renderAudit();render();setView();$('#loading').hidden=true;$('#content').hidden=false;
}catch(err){$('#loading').innerHTML=`Не удалось загрузить архив. Обновите страницу или <a href="data/dataset.json">скачайте данные</a>.`;console.error(err);}
