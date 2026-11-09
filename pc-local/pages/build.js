const fs=require('fs'),os=require('os'),path=require('path');
const src=fs.readFileSync('questions/index.html','utf8');
const m=src.match(/const Y=[\s\S]*?\n\];\n/)[0];
const old=new Function(m+';return Q')();
const dir=path.join(os.homedir(),'x2f-comms/owner-answers-raw/answers');
const have=new Set(fs.readdirSync(dir).map(f=>f.replace('.json','')));
const drop=new Set([78]);
const left=old.map((q,i)=>({...q,n:i+1})).filter(q=>!have.has('q'+q.n)&&!drop.has(q.n));
const NEW=[
{s:'Sign these',q:'Sign this wording for the screen after "I\'ve paid"?',n:'"When they release, 1.250000 XMR goes to your wallet once your app co-signs. Keep this page open until it arrives."\n\nThe old line said the app co-signs by itself, which is untrue: the page has to stay open.',o:['Signed','Reject it'],r:0},
{s:'Sign these',q:'Sign this wording for the refund screen?',n:'"Open a dispute and add your payment proof. If the money reached satoshi_ghost, a moderator can rule that they owe you the 1.250000 XMR. Until they pay it back, they can\'t trade."\n\nThe old line promised a moderator "makes them" pay, which we can\'t do.',o:['Signed','Reject it'],r:0},
{s:'Staff',q:'Must every moderator hold all three: security key, PGP key and passkey?',n:'You said a moderator has a minimum of all three, and a new device needs two of the three. Today the code lets a moderator join without a passkey, and refuses security key plus passkey as a pair.',o:['All three required, and any two log in on a new device','Keep today\'s stricter pairs: PGP must be one of the two'],r:0},
{s:'Staff',q:'Should permanently removing a staff member, or an owner key, need a security key tap?',n:'Today a logged-in owner session is enough. A stolen session could remove every staff member for good.',o:['Yes, require a tap','No, a session is enough'],r:0},
{s:'Holds',q:'Should removing a wallet or team member also wait 24 hours when done with only a username and password?',n:'Today adding waits 24 hours, but removing is instant. A thief could delete your wallets and team now, then queue their own wallet, so it becomes your only wallet after 24 hours.',o:['Yes, removals wait 24 hours too','Keep removals instant'],r:0},
{s:'Holds',q:'PGP login uses the key with no username. Is that fine?',n:'You said a strong login is username and PGP. Today the PGP login takes only the key: whoever can answer the key\'s challenge gets in, which already proves they hold the private key. Adding a username means one more thing a person must type, and a private login name stays private.',o:['Add the username: username and PGP','Key alone is fine'],r:0},
{s:'Holds',q:'During someone\'s account hold, can their trade partner still open a dispute?',n:'A paused trade currently refuses disputes, so a partner who has paid can\'t reach a moderator. I\'ve told claude2 to allow it for now, because a person who has paid must always be able to reach a moderator.',o:['Yes, always allow a dispute','No, wait for the hold to end'],r:0},
{s:'Sessions',q:'Can an account in a 24-hour hold still extend its session?',o:['Yes','No'],r:0,n:'Extending needs a login method, and the hold doesn\'t stop it today.'},
{s:'Sessions',q:'Should extending a session send an alert?',o:['No alert','Yes, alert on every extend'],r:0,n:'Extends happen a lot, so alerts would become noise.'},
{s:'Sessions',q:'Is one login method enough to extend a session?',n:'A team member\'s login needs two methods, but extending needs one. A password-only account extends with the password alone.',o:['One is enough','Require the same as login'],r:0},
{s:'Vendors',q:'Should a vendor get a warning before the 60-day auto-close?',n:'Today it closes with no warning.',o:['Yes: warnings at 45 and 55 days','No warning'],r:0},
{s:'Vendors',q:'Can staff reopen an account that auto-closed?',n:'Today nothing can reopen it, even a mistake after an outage.',o:['Yes, senior moderators and the owner','No, never'],r:0},
{s:'Vendors',q:'Can a vendor remove its only strong login key after switching?',n:'Becoming a vendor needs a passkey, security key or PGP, but it could then be removed, leaving a password-only vendor.',o:['No, a vendor always keeps one','Yes'],r:0},
{s:'Vendors',q:'May someone whose account auto-closed reuse their key or names on a new account?',o:['No: new key and new names','Yes, after 60 days more'],r:0,n:'You said they open a new account. Today names and PGP keys stay taken forever.'},
{s:'Offers',q:'What can make one amount band different from another?',n:'You said bands must differ, but the list of what can differ isn\'t settled. Options can be mixed.',o:['Minimum past trades and the ± %, and the amounts can\'t overlap','Also allow different payment types per band'],r:0},
];
const keep=left.filter(q=>q.t!==1);
const text=left.filter(q=>q.t===1);
const all=[...NEW,...keep.map(({n,b,w,k,...x})=>({...x,s:(x.s)+' · old Q'+n})),...text.map(({n,...x})=>({...x,o:[],s:x.s+' · old Q'+n}))];
for(const q of all){if(q.d)q.n=(q.n?q.n+'\n\n':'')+'Design recommends: '+q.d;delete q.d;delete q.f;delete q.t}
let t=fs.readFileSync('followups/index.html','utf8');
t=t.slice(t.indexOf('<title>'),t.lastIndexOf('</body>'));
t=t.replace(/const Q=\[[\s\S]*?\n\];\nQ\.forEach/,'const Q='+JSON.stringify(all)+';\nQ.forEach').replace("x.id='f'+(i+1)","x.id='g'+(i+1)").replace('X2F Owner Follow-ups','X2F Remaining Questions').replace('<h1>X2F follow-ups</h1>','<h1>X2F remaining questions</h1>').replace(/x2f-fu/g,'x2f-rq');
fs.writeFileSync('remaining/index.html',t);
const s=t.match(/<script>([\s\S]*)<\/script>/)[1];new Function(s.replace(/await /g,'').replace('(async()','(()'));
console.log('old left',left.length,'new',NEW.length,'total',all.length);console.log(left.map(q=>q.n).join(' '));
