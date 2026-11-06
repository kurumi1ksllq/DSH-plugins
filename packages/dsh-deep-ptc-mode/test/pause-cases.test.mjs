import assert from 'node:assert/strict';
import { programPauseIssue as P, shellPauseSeconds as S } from '../lib/sleep-lint.mjs';
const shell = [
 // expect 0: mention only
 ['echo "文档里写了 sleep 10 秒"',0],["git commit -m 'fix sleep 10 bug'",0],["echo 'Start-Sleep -Seconds 60'",0],["Select-String -Pattern 'sleep 30'",0,'powershell'],
 ['grep -r "sleep 30" src',0],['grep -r sleep 30',0],['# sleep 60\nls',0],["cat > a.sh <<'EOF'\nsleep 60\nEOF\nls",0],['cat <<EOF\n  sleep 60\nEOF',0],['cat <<-EOF\n\tsleep 60\n\tEOF\nsleep 2',2],
 ['echo sleep 60',0],['echo sleeping 30',0],['ls 2>&1 | grep sleep',0],['sleep 60 &',0],['sleep 60 & pid=$!; echo $pid',0],['man sleep 60',0],["python -c 'import time; time.sleep(60)'",0],
 ['echo "it\'s sleep 60"',0],["echo 'a'\"sleep 60\"",0],['echo \\"sleep 60\\"',0],['ssh h "ls"',0],['find . -name "*.log" -exec rm {} \;',0],
 ["@'\nsleep 60\n'@ | Set-Content a.ps1",0,'powershell'],["<# sleep 60 #>\nls",0,'powershell'],['echo "C:\\foo\\"; ls',0,'powershell'],["Write-Host 'it''s sleep 60'",0,'powershell'],
 // expect real
 ['sleep 60',60],['make; sleep 2m',120],['sleep 1m 30s',90],['sleep infinity',Infinity],['sleep 2 && curl x',2],['until curl -s l; do sleep 1; done',1],['while true; do sleep 60; done',60],['for i in 1 2; do sleep 60; done',60],
 ['(sleep 60)',60],['{ sleep 60; }',60],['echo "$(sleep 60)"',60],['echo $(sleep 60)',60],['echo `sleep 60`',60],['bash -c "sleep 60"',60],['bash -lc "cd x && sleep 60"',60],["sh -c 'sleep 60'",60],['X=1 sleep 60',60],['nohup sleep 60',60],['sudo sleep 60',60],['/bin/sleep 60',60],['sleep 60 2>&1',60],['sleep 60 >/dev/null 2>&1',60],['sleep 60 | cat',60],['time sleep 60',60],['! sleep 60',60],['if true; then sleep 60; fi',60],
 ['wsl -- sleep 20',20],['wsl sleep 20',20],['wsl -d Ubuntu -- sleep 20',20],['wsl -e sleep 20',20],['wsl bash -c "sleep 20"',20],
 ['Start-Sleep -Seconds 30',30,'powershell'],['Start-Sleep 10',10,'powershell'],['Start-Sleep -Milliseconds 500',0.5,'powershell'],['Start-Sleep -s 30',30,'powershell'],['start-sleep -Seconds:30',30,'powershell'],['sleep 30',30,'powershell'],['1..3 | % { Start-Sleep 30 }',30,'powershell'],['foreach ($x in $y) { Start-Sleep 30 }',30,'powershell'],['if ($true) { sleep 30 }',30,'powershell'],['timeout /t 20 /nobreak',20,'powershell'],['timeout /T 20',20,'powershell'],['timeout.exe /t 20',20,'powershell'],['timeout /t -1',Infinity,'powershell'],['cmd /c "timeout /t 20"',20,'powershell'],['cmd.exe /c timeout /t 20',20,'powershell'],['pwsh -NoProfile -Command "Start-Sleep 30"',30,'powershell'],['powershell -c Start-Sleep 30',30,'powershell'],['echo "$(Start-Sleep 30)"',30,'powershell'],['& { Start-Sleep 30 }',30,'powershell'],['$x = Start-Sleep 30',0,'powershell-gap'],
 ['Start-Sleep -Duration 00:00:30',0,'powershell'],
 ['timeout 10 ls',0],
];
let bad=0; for (const [c,e,d] of shell){ const dialect = d==='powershell-gap'?'powershell':d; const g=S(c,dialect); if(g!==e){bad++;console.log('SHELL MISMATCH',JSON.stringify(c),'expected',e,'got',g);} }
const code = [
 // allow
 ['const D = 3000; setTimeout(r, D)',0],['// setTimeout(cb, 90000) 只是注释',0],["const s = 'setTimeout(x, 60000)'",0],['setInterval(() => {}, 100)',0],["const s = 'setInterval('",0],["const s = 'time.sleep(30)'",0],['/* setTimeout(r,60000) */',0],['const t = `setTimeout(r, 60000)`',0],['const r = /setTimeout\\(r, 60000\\)/',0],['const x = a / 2; const y = "setTimeout(r, 60000)"; const z = b / 3',0],
 ['await new Promise(r => setTimeout(r, 1000)); return 1',0],['const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(500)',0],["const { setTimeout: wait } = await import('node:timers/promises'); await wait(2000)",0],['setTimeout(() => done(), 0)',0],['setTimeout(() => ctrl.abort(), 60000); await fetch(u)',0],['await Promise.race([work(), new Promise((_, rej) => setTimeout(() => rej(new Error("t")), 30000))])',0],['setTimeout(() => console.log("slow"), 60000); return 1',0],['Atomics.wait(v,0,0,100)',0],['const sleepy = "sleep(100)"',0],
 ['const t = `a ${x} b`; return t',0],['await new Promise(r => setTimeout(r, compute()))',0],['clearTimeout(setTimeout(f, 60000))',0],
 // refuse
 ['await new Promise(r => setTimeout(r, 60_000))',1],['await new Promise(r => setTimeout(r, 60 * 1000))',1],['const D = 60000; await new Promise(r => setTimeout(r, D))',1],['const S = 1000; const D = 60*S; await new Promise(r => setTimeout(r, D))',1],['const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(60000)',1],['const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms)); await sleep(60000)',1],['function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }\nawait sleep(60000)',1],['async function wait(ms) { await new Promise(res => setTimeout(() => res(), ms)) }\nawait wait(60*1000)',1],['await new Promise<void>(r => setTimeout(r, 60000))',1],["const { setTimeout: wait } = await import('node:timers/promises'); await wait(60000)",1],["const t = await import('node:timers/promises'); await t.setTimeout(60000)",1],['await new Promise(r => { const t = setInterval(() => { if (ok()) { clearInterval(t); r(); } }, 60000); })',1],['Atomics.wait(v,0,0)',1],['Atomics.wait(v,0,0,60000)',1],['const m = `${await new Promise(r => setTimeout(r, 60000))}`',1],
 // gaps documented
];
for (const [c,e] of code){ const g=P(c); if(!!g!==!!e){bad++;console.log('CODE MISMATCH',JSON.stringify(c),'expected',e?'refuse':'allow','got',g);} }
const py=[["import time\ntime.sleep(30)",1],["import asyncio\nawait asyncio.sleep(1)",0],["from time import sleep\nsleep(10)",1],["# time.sleep(30)",0],["s = 'time.sleep(30)'",0],['s = """\ntime.sleep(30)\n"""',0],["D = 30\ntime.sleep(D)",1],["def sleep(x): pass\nsleep(100)",0],["obj.sleep(100)",0]];
for (const [c,e] of py){ const g=P(c,'python'); if(!!g!==!!e){bad++;console.log('PY MISMATCH',JSON.stringify(c),'expected',e?'refuse':'allow','got',g);} }
console.log('mismatches',bad,'of',shell.length+code.length+py.length);

assert.equal(bad,0,'pause detection regressions');
