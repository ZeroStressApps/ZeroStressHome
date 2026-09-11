import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile, signOut,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, query, orderBy,
  onSnapshot, serverTimestamp, deleteDoc, updateDoc, arrayUnion, writeBatch,
  where, addDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

// Mantener la sesión iniciada en este dispositivo.
// En navegación privada/incógnito, el navegador puede borrar la sesión al cerrar.
const authPersistenceReady = setPersistence(auth, browserLocalPersistence);

// Recordar el email para no tener que escribirlo cada vez.
const savedEmail = localStorage.getItem("zerostresshome_email");
if (savedEmail && $("emailInput")) $("emailInput").value = savedEmail;
const state = {
  user: null, homeId: null, home: null, reservations: [], expenses: [],
  current: new Date(), selected: null, selectedStart: null, selectedEnd: null,
  unsubscribe: null, expenseUnsubscribe: null, expenseMonthStatus: null, authMode: "login",
  expenseMonth: new Date()
};

const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const weekdays = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

function show(id, visible=true){ $(id).classList.toggle("hidden", !visible); }
function msg(id, text, error=false){ const el=$(id); el.textContent=text; el.classList.toggle("error", error); }
function keyDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function dateFromKey(k){ const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); }
function prettyDate(k){ const d=dateFromKey(k); return `${weekdays[d.getDay()].replace(/^./,c=>c.toUpperCase())} ${d.getDate()} de ${months[d.getMonth()]}`; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }

function switchAuthMode(mode){
  state.authMode=mode;
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active", b.dataset.authTab===mode));
  document.querySelectorAll(".register-only").forEach(e=>e.classList.toggle("hidden", mode!=="register"));
  $("authSubmit").textContent=mode==="register"?"Crear cuenta":"Entrar";
  msg("authMessage","");
}
document.querySelectorAll("[data-auth-tab]").forEach(b=>b.addEventListener("click",()=>switchAuthMode(b.dataset.authTab)));

$("togglePasswordBtn").addEventListener("click",()=>{
  const input=$("passwordInput");
  const showing=input.type==="text";
  input.type=showing?"password":"text";
  $("togglePasswordBtn").textContent=showing?"Ver":"Ocultar";
  $("togglePasswordBtn").setAttribute("aria-label",showing?"Mostrar contraseña":"Ocultar contraseña");
});

$("authForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const email=$("emailInput").value.trim();
  const password=$("passwordInput").value;
  try{
    await authPersistenceReady;
    localStorage.setItem("zerostresshome_email", email);
    if(state.authMode==="register"){
      const name=$("nameInput").value.trim();
      if(!name) throw new Error("Escribe tu nombre.");
      const cred=await createUserWithEmailAndPassword(auth,email,password);
      await updateProfile(cred.user,{displayName:name});
    } else await signInWithEmailAndPassword(auth,email,password);
  }catch(err){ msg("authMessage", friendlyError(err), true); }
});
$("logoutBtn").addEventListener("click",()=>signOut(auth));

function friendlyError(err){
  const code=err?.code||"";
  const map={
    "auth/invalid-credential":"Email o contraseña incorrectos.",
    "auth/email-already-in-use":"Ese email ya tiene una cuenta.",
    "auth/weak-password":"La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-email":"Ese email no parece válido.",
    "auth/too-many-requests":"Demasiados intentos. Firebase se ha puesto dramático. Prueba más tarde."
  };
  return map[code]||err.message||"Ha ocurrido un error.";
}

async function findOrCreateMembership(uid){
  const ref=doc(db,"users",uid);
  const snap=await getDoc(ref);
  if(snap.exists()) return snap.data().homeId||null;
  await setDoc(ref,{name:auth.currentUser.displayName||auth.currentUser.email.split("@")[0],email:auth.currentUser.email,createdAt:serverTimestamp()},{merge:true});
  return null;
}

$("createHomeBtn").addEventListener("click",async()=>{
  try{
    const id=makeCode();
    const ref=doc(db,"homes",id);
    const name=auth.currentUser.displayName||auth.currentUser.email.split("@")[0];
    await setDoc(ref,{name:"ZeroStressHome",inviteCode:id,members:[auth.currentUser.uid],memberNames:{[auth.currentUser.uid]:name},createdAt:serverTimestamp()});
    await setDoc(doc(db,"users",auth.currentUser.uid),{homeId:id},{merge:true});
    await enterHome(id);
  }catch(err){msg("setupMessage",friendlyError(err),true);}
});

$("joinHomeBtn").addEventListener("click",async()=>{
  const id=$("inviteInput").value.trim().toUpperCase();
  if(id.length<6){msg("setupMessage","Introduce un código válido.",true);return;}
  try{
    const ref=doc(db,"homes",id), snap=await getDoc(ref);
    if(!snap.exists()) throw new Error("No encuentro una casa con ese código.");
    const name=auth.currentUser.displayName||auth.currentUser.email.split("@")[0];
    await updateDoc(ref,{members:arrayUnion(auth.currentUser.uid),[`memberNames.${auth.currentUser.uid}`]:name});
    await setDoc(doc(db,"users",auth.currentUser.uid),{homeId:id},{merge:true});
    await enterHome(id);
  }catch(err){msg("setupMessage",friendlyError(err),true);}
});

function makeCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}

async function enterHome(id){
  state.homeId=id;
  const snap=await getDoc(doc(db,"homes",id));
  state.home=snap.data();
  show("authView",false); show("setupView",false); show("appView",true); show("logoutBtn",true);
  $("homeCode").textContent=id;
  $("homeTitle").textContent=state.home.name||"ZeroStressHome";
  subscribeReservations();
  subscribeExpenses();
  renderCalendar();
}

function subscribeReservations(){
  if(state.unsubscribe) state.unsubscribe();
  const q=query(collection(db,"homes",state.homeId,"reservations"),orderBy("date"));
  state.unsubscribe=onSnapshot(q,snap=>{
    state.reservations=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderCalendar(); renderList();
  },err=>showStatus(friendlyError(err),true));
}

function reservationFor(date){
  return state.reservations.find(r=>r.date===date);
}

function isBetween(k,start,end){
  if(!start || !end) return false;
  return k>=start && k<=end;
}

function daysBetweenInclusive(start,end){
  const out=[];
  if(!start || !end) return out;
  let d=dateFromKey(start), last=dateFromKey(end);
  while(d<=last){
    out.push(keyDate(d));
    d.setDate(d.getDate()+1);
  }
  return out;
}

function formatRange(start,end){
  if(!start) return "Elige desde cuándo estarás";
  if(!end) return `Desde ${prettyDate(start)} · elige hasta cuándo`;
  if(start===end) return prettyDate(start);
  const a=dateFromKey(start), b=dateFromKey(end);
  if(a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth()){
    return `${a.getDate()}–${b.getDate()} de ${months[a.getMonth()]}`;
  }
  return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]}`;
}

function renderCalendar(){
  const d=state.current, y=d.getFullYear(), m=d.getMonth();
  $("monthTitle").textContent=`${months[m][0].toUpperCase()+months[m].slice(1)} ${y}`;
  const first=new Date(y,m,1), days=new Date(y,m+1,0).getDate();
  let start=(first.getDay()+6)%7;
  let html="";
  for(let i=0;i<start;i++) html+=`<button class="day empty" disabled></button>`;
  for(let n=1;n<=days;n++){
    const date=new Date(y,m,n), k=keyDate(date), r=reservationFor(k);
    const mine=r?.users?.includes(state.user.uid), other=r && !mine;
    const overlap=r?.users?.length>1;
    const inRange=isBetween(k,state.selectedStart,state.selectedEnd);
    const rangeStart=state.selectedStart===k;
    const rangeEnd=state.selectedEnd===k;
    const cls=["day",mine?"mine-day":"",other?"other-day":"",overlap?"overlap-day":"",
      inRange?"in-range":"",rangeStart?"range-start":"",rangeEnd?"range-end":"",
      state.selected===k?"selected":"",k===keyDate(new Date())?"today":""].filter(Boolean).join(" ");
    const label=r?.users?.map(uid=>uid===state.user.uid?"Tú":(state.home.memberNames?.[uid]||"Otra persona")).join(" + ");
    html+=`<button class="${cls}" data-date="${k}"><span>${n}</span>${label?`<small>${escapeHtml(label)}</small>`:""}</button>`;
  }
  $("calendarGrid").innerHTML=html;
  document.querySelectorAll(".day[data-date]").forEach(b=>b.addEventListener("click",()=>selectDate(b.dataset.date)));
  updateSelection();
}

function syncDateInputs(){
  $("startDateInput").value=state.selectedStart||"";
  $("endDateInput").value=state.selectedEnd||"";
  $("endDateInput").min=state.selectedStart||"";
}

function selectDate(k){
  if(!state.selectedStart || (state.selectedStart && state.selectedEnd)){
    state.selectedStart=k;
    state.selectedEnd=null;
    state.selected=k;
  } else {
    if(k<state.selectedStart){
      state.selectedEnd=state.selectedStart;
      state.selectedStart=k;
    } else {
      state.selectedEnd=k;
    }
    state.selected=k;
  }
  syncDateInputs();
  renderCalendar();
}

function updateSelection(){
  const start=state.selectedStart, end=state.selectedEnd;
  const complete=!!(start && end);
  const count=complete?daysBetweenInclusive(start,end).length:(start?1:0);
  $("selectionTitle").textContent=complete?formatRange(start,end):(start?formatRange(start,null):"Elige una estancia");
  $("selectionHint").textContent=!start
    ?"Selecciona el primer día y después el último, como en una reserva de hotel."
    :!end
      ?"Ahora selecciona el último día de tu estancia. Los dos días se incluyen."
      :`${count} ${count===1?"día":"días"} seleccionados. Si ya hay otra persona en alguno, podréis coincidir.`;
  $("toggleDayBtn").disabled=!complete;
  $("toggleDayBtn").textContent=complete?`Reservar ${count} ${count===1?"día":"días"}`:"Elige desde y hasta";
  syncDateInputs();
}

$("startDateInput").addEventListener("change",()=>{
  const k=$("startDateInput").value;
  if(!k) return;
  state.selectedStart=k;
  if(state.selectedEnd && state.selectedEnd<k) state.selectedEnd=null;
  state.selected=k;
  state.current=dateFromKey(k);
  renderCalendar();
});

$("endDateInput").addEventListener("change",()=>{
  const k=$("endDateInput").value;
  if(!k) return;
  if(!state.selectedStart){
    state.selectedStart=k;
    state.selectedEnd=k;
  } else if(k<state.selectedStart){
    state.selectedEnd=state.selectedStart;
    state.selectedStart=k;
  } else {
    state.selectedEnd=k;
  }
  state.selected=k;
  state.current=dateFromKey(k);
  renderCalendar();
});

$("toggleDayBtn").addEventListener("click",async()=>{
  const start=state.selectedStart, end=state.selectedEnd;
  if(!start || !end) return;
  const days=daysBetweenInclusive(start,end);
  const batch=writeBatch(db);
  try{
    for(const k of days){
      const ref=doc(db,"homes",state.homeId,"reservations",k);
      batch.set(ref,{date:k,users:arrayUnion(state.user.uid),updatedAt:serverTimestamp()},{merge:true});
    }
    await batch.commit();
    const count=days.length;
    showStatus(`${count} ${count===1?"día reservado":"días reservados"}.`);
  }catch(err){
    showStatus(friendlyError(err),true);
  }
});


function expenseMonthKey(d=state.expenseMonth){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function expenseMonthLabel(d=state.expenseMonth){
  return `${months[d.getMonth()][0].toUpperCase()+months[d.getMonth()].slice(1)} ${d.getFullYear()}`;
}

function formatMoney(n){
  return Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";
}


function expenseMonthDoc(){
  return doc(db,"homes",state.homeId,"expenseMonths",expenseMonthKey());
}

async function loadExpenseMonthStatus(){
  try{
    const snap=await getDoc(expenseMonthDoc());
    state.expenseMonthStatus=snap.exists()?snap.data():null;
    renderExpenses();
  }catch(err){
    showStatus(friendlyError(err),true);
  }
}

function renderPaidStatus(rows,total){
  const paid=!!state.expenseMonthStatus?.paid;
  const title=$("expensePaidTitle");
  const text=$("expensePaidText");
  const button=$("markMonthPaidBtn");
  const box=$("expensePaidStatus");

  if(paid){
    box.classList.add("is-paid");
    title.textContent="Mes pagado ✓";
    text.textContent=`Deuda saldada · ${formatMoney(total/2)} correspondiente a la otra persona.`;
    button.textContent="Marcar como pendiente";
    button.classList.add("ghost");
    button.classList.remove("secondary");
  }else{
    box.classList.remove("is-paid");
    title.textContent=rows.length?"Mes pendiente de pago":"Mes sin gastos";
    text.textContent=rows.length
      ? `Pendiente: ${formatMoney(total/2)} que debe abonar la otra persona.`
      : "Cuando haya gastos y Marta te haga el Bizum, podrás marcar el mes como pagado.";
    button.textContent="Marcar mes como pagado";
    button.classList.add("secondary");
    button.classList.remove("ghost");
  }
}

function subscribeExpenses(){
  if(state.expenseUnsubscribe) state.expenseUnsubscribe();
  const q=query(
    collection(db,"homes",state.homeId,"expenses"),
    orderBy("date","desc")
  );
  state.expenseUnsubscribe=onSnapshot(q,snap=>{
    state.expenses=snap.docs.map(d=>({id:d.id,...d.data()}));
    loadExpenseMonthStatus();
  },err=>showStatus(friendlyError(err),true));
}

function renderExpenses(){
  const key=expenseMonthKey();
  $("expensesMonthTitle").textContent=`Gastos de ${expenseMonthLabel()}`;
  const rows=(state.expenses||[]).filter(e=>(e.month||String(e.date||"").slice(0,7))===key);
  const total=rows.reduce((sum,e)=>sum+Number(e.amount||0),0);
  const half=total/2;
  $("expensesTotal").textContent=formatMoney(total);
  $("expensesHalf").textContent=`${formatMoney(half)} cada una`;
  renderPaidStatus(rows,total);

  const members=state.home?.members||[];
  const memberNames=state.home?.memberNames||{};
  const contributions={};
  members.forEach(uid=>contributions[uid]=0);
  rows.forEach(e=>{
    if(e.paidBy) contributions[e.paidBy]=(contributions[e.paidBy]||0)+Number(e.amount||0);
  });

  const balanceEl=$("expenseBalance");
  if(!rows.length){
    balanceEl.innerHTML=`<span>Liquidación</span><strong>Sin gastos todavía</strong>`;
    $("expenseList").innerHTML=`<p class="empty-state">Todavía no hay gastos este mes.</p>`;
    return;
  }

  if(members.length>=2){
    const a=members[0], b=members[1];
    const diff=(contributions[a]||0)-half;
    let text="Está todo a medias";
    if(Math.abs(diff)>0.005){
      const debtor=diff>0?b:a;
      const creditor=diff>0?a:b;
      const debtorName=debtor===state.user.uid?"Tú":(memberNames[debtor]||"La otra persona");
      const creditorName=creditor===state.user.uid?"tú":(memberNames[creditor]||"la otra persona");
      text=`${debtorName} debe ${formatMoney(Math.abs(diff))} a ${creditorName}`;
    }
    balanceEl.innerHTML=`<span>Liquidación</span><strong>${escapeHtml(text)}</strong>`;
  } else {
    balanceEl.innerHTML=`<span>Liquidación</span><strong>Cada una: ${formatMoney(half)}</strong>`;
  }

  const categoryNames={luz:"Luz",agua:"Agua",limpieza:"Limpieza",otros:"Otros"};
  $("expenseList").innerHTML=rows.map(e=>{
    const payer=e.paidBy===state.user.uid?"Tú":(memberNames[e.paidBy]||"Otra persona");
    return `<div class="expense-row">
      <div class="expense-icon">${e.category==="luz"?"💡":e.category==="agua"?"💧":e.category==="limpieza"?"🧹":"🧾"}</div>
      <div class="expense-main">
        <strong>${escapeHtml(categoryNames[e.category]||"Otros")}</strong>
        <small>${escapeHtml(e.note||"Sin nota")} · pagado por ${escapeHtml(payer)}</small>
      </div>
      <strong class="expense-amount">${formatMoney(e.amount)}</strong>
      ${e.paidBy===state.user.uid?`<button class="expense-delete ghost" data-expense="${e.id}" aria-label="Eliminar gasto">×</button>`:""}
    </div>`;
  }).join("");

  document.querySelectorAll(".expense-delete").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      try{
        await deleteDoc(doc(db,"homes",state.homeId,"expenses",btn.dataset.expense));
        showStatus("Gasto eliminado.");
      }catch(err){showStatus(friendlyError(err),true);}
    });
  });
}

$("prevExpenseMonth").addEventListener("click",()=>{
  state.expenseMonth.setMonth(state.expenseMonth.getMonth()-1);
  state.expenseMonthStatus=null;
  renderExpenses();
  loadExpenseMonthStatus();
});

$("nextExpenseMonth").addEventListener("click",()=>{
  state.expenseMonth.setMonth(state.expenseMonth.getMonth()+1);
  state.expenseMonthStatus=null;
  renderExpenses();
  loadExpenseMonthStatus();
});


$("markMonthPaidBtn").addEventListener("click",async()=>{
  const key=expenseMonthKey();
  const rows=(state.expenses||[]).filter(e=>(e.month||String(e.date||"").slice(0,7))===key);
  const total=rows.reduce((sum,e)=>sum+Number(e.amount||0),0);
  if(!rows.length){
    showStatus("No hay gastos en este mes.",true);
    return;
  }
  const currentlyPaid=!!state.expenseMonthStatus?.paid;
  try{
    if(currentlyPaid){
      await deleteDoc(expenseMonthDoc());
      state.expenseMonthStatus=null;
      showStatus("El mes vuelve a quedar pendiente.");
    }else{
      await setDoc(expenseMonthDoc(),{
        paid:true,
        paidAt:serverTimestamp(),
        paidBy:state.user.uid,
        amountDue:Math.round((total/2)*100)/100
      });
      state.expenseMonthStatus={paid:true,amountDue:Math.round((total/2)*100)/100};
      showStatus("Mes marcado como pagado ✓");
    }
    renderExpenses();
  }catch(err){showStatus(friendlyError(err),true);}
});

$("addExpenseBtn").addEventListener("click",async()=>{
  const amount=Number(String($("expenseAmount").value).replace(",","."));
  if(!Number.isFinite(amount)||amount<=0){
    showStatus("Introduce un importe válido.",true);
    return;
  }
  const category=$("expenseCategory").value;
  const note=$("expenseNote").value.trim();
  const date=new Date();
  const month=expenseMonthKey();
  try{
    await addDoc(collection(db,"homes",state.homeId,"expenses"),{
      category, amount:Math.round(amount*100)/100, note,
      month, date:keyDate(date), paidBy:state.user.uid,
      paidByName:auth.currentUser.displayName||auth.currentUser.email,
      createdAt:serverTimestamp()
    });
    $("expenseAmount").value="";
    $("expenseNote").value="";
    showStatus("Gasto añadido.");
  }catch(err){showStatus(friendlyError(err),true);}
});

function groupReservations(rows){
  const sorted=[...rows].sort((a,b)=>a.date.localeCompare(b.date));
  const groups=[];
  for(const r of sorted){
    const users=(r.users||[]).slice().sort().join("|");
    const last=groups[groups.length-1];
    if(last && last.usersKey===users){
      const next=dateFromKey(last.end);
      next.setDate(next.getDate()+1);
      if(keyDate(next)===r.date){
        last.end=r.date;
        continue;
      }
    }
    groups.push({start:r.date,end:r.date,usersKey:users,users:r.users||[]});
  }
  return groups;
}

function renderList(){
  const today=keyDate(new Date());
  const upcoming=state.reservations.filter(r=>r.date>=today);
  const groups=groupReservations(upcoming);
  $("reservationCount").textContent=upcoming.length;
  if(!groups.length){
    $("reservationList").innerHTML=`<p class="empty-state">Todavía no hay días reservados. La humanidad puede sobrevivir a esto.</p>`;
    return;
  }
  $("reservationList").innerHTML=groups.slice(0,30).map(g=>{
    const names=g.users.map(uid=>uid===state.user.uid?"Tú":(state.home.memberNames?.[uid]||"Otra persona"));
    const first=dateFromKey(g.start);
    return `<button class="reservation-row" data-date="${g.start}">
      <span class="date-box"><b>${first.getDate()}</b><small>${months[first.getMonth()].slice(0,3)}</small></span>
      <span><strong>${escapeHtml(names.join(" + "))}</strong><small>${escapeHtml(formatRange(g.start,g.end))}</small></span>
      <span>›</span>
    </button>`;
  }).join("");
  document.querySelectorAll(".reservation-row").forEach(b=>b.addEventListener("click",()=>{
    const k=b.dataset.date;
    const group=groups.find(g=>g.start===k);
    if(group){
      state.selectedStart=group.start;
      state.selectedEnd=group.end;
      state.selected=group.start;
      state.current=dateFromKey(group.start);
      renderCalendar();
    }
  }));
}

$("prevMonth").addEventListener("click",()=>{state.current.setMonth(state.current.getMonth()-1);renderCalendar();});
$("nextMonth").addEventListener("click",()=>{state.current.setMonth(state.current.getMonth()+1);renderCalendar();});
$("todayBtn").addEventListener("click",()=>{
  const today=keyDate(new Date());
  state.current=new Date();
  state.selectedStart=today;
  state.selectedEnd=today;
  state.selected=today;
  renderCalendar();
});
$("copyCodeBtn").addEventListener("click",async()=>{
  await navigator.clipboard.writeText(state.homeId);
  showStatus("Código copiado.");
});

function showStatus(text,error=false){
  const el=$("statusMessage");el.textContent=text;el.classList.toggle("show",true);el.classList.toggle("error",error);
  setTimeout(()=>el.classList.remove("show"),2600);
}

let deferredInstall;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;show("installBtn",true);});
$("installBtn").addEventListener("click",async()=>{if(!deferredInstall)return;deferredInstall.prompt();deferredInstall=null;show("installBtn",false);});
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

onAuthStateChanged(auth,async user=>{
  state.user=user;
  if(!user){show("authView",true);show("setupView",false);show("appView",false);show("logoutBtn",false);return;}
  try{
    const homeId=await findOrCreateMembership(user.uid);
    if(homeId) await enterHome(homeId);
    else {show("authView",false);show("setupView",true);show("appView",false);show("logoutBtn",true);}
  }catch(err){show("authView",false);show("setupView",true);msg("setupMessage",friendlyError(err),true);}
});
