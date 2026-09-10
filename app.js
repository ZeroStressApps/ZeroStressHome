import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, query, orderBy,
  onSnapshot, serverTimestamp, deleteDoc, updateDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const state = {
  user: null, homeId: null, home: null, reservations: [],
  current: new Date(), selected: null, unsubscribe: null, authMode: "login"
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

$("authForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const email=$("emailInput").value.trim();
  const password=$("passwordInput").value;
  try{
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
    const cls=["day",mine?"mine-day":"",other?"other-day":"",overlap?"overlap-day":"",state.selected===k?"selected":"",k===keyDate(new Date())?"today":""].filter(Boolean).join(" ");
    const label=r?.users?.map(uid=>uid===state.user.uid?"Tú":(state.home.memberNames?.[uid]||"Otra persona")).join(" + ");
    html+=`<button class="${cls}" data-date="${k}"><span>${n}</span>${label?`<small>${escapeHtml(label)}</small>`:""}</button>`;
  }
  $("calendarGrid").innerHTML=html;
  document.querySelectorAll(".day[data-date]").forEach(b=>b.addEventListener("click",()=>selectDate(b.dataset.date)));
  updateSelection();
}

function selectDate(k){
  state.selected=k;
  updateSelection();
  renderCalendar();
}
function updateSelection(){
  const r=state.selected&&reservationFor(state.selected);
  $("selectionTitle").textContent=state.selected?prettyDate(state.selected):"Elige un día";
  const mine=r?.users?.includes(state.user.uid);
  const other=r && !mine;
  const overlap=r?.users?.length>1;
  if(!state.selected){$("toggleDayBtn").disabled=true;return;}
  $("toggleDayBtn").disabled=false;
  $("toggleDayBtn").textContent=mine?(overlap?"Quitar mi reserva":"Cancelar día"):(other?"Reservar también":"Reservar día");
  $("selectionHint").textContent=overlap?"Estaréis los dos en casa ese día.":other?"La otra persona ya estará. Puedes reservar el mismo día.":"Toca el botón para indicar que estarás en casa.";
}

$("toggleDayBtn").addEventListener("click",async()=>{
  if(!state.selected) return;
  const k=state.selected, ref=doc(db,"homes",state.homeId,"reservations",k), r=reservationFor(k);
  try{
    if(!r){
      await setDoc(ref,{date:k,users:[state.user.uid],updatedAt:serverTimestamp()});
      showStatus("Día reservado.");
    }else{
      const users=r.users||[];
      if(users.includes(state.user.uid)){
        const next=users.filter(x=>x!==state.user.uid);
        if(next.length) await updateDoc(ref,{users:next,updatedAt:serverTimestamp()});
        else await deleteDoc(ref);
        showStatus("Tu reserva se ha quitado.");
      }else{
        await updateDoc(ref,{users:[...users,state.user.uid],updatedAt:serverTimestamp()});
        showStatus("Día compartido. Los dos estaréis en casa.");
      }
    }
  }catch(err){showStatus(friendlyError(err),true);}
});

function renderList(){
  const today=keyDate(new Date());
  const upcoming=state.reservations.filter(r=>r.date>=today);
  $("reservationCount").textContent=upcoming.length;
  if(!upcoming.length){$("reservationList").innerHTML=`<p class="empty-state">Todavía no hay días reservados. La humanidad puede sobrevivir a esto.</p>`;return;}
  $("reservationList").innerHTML=upcoming.slice(0,30).map(r=>{
    const names=(r.users||[]).map(uid=>uid===state.user.uid?"Tú":(state.home.memberNames?.[uid]||"Otra persona"));
    return `<button class="reservation-row" data-date="${r.date}">
      <span class="date-box"><b>${dateFromKey(r.date).getDate()}</b><small>${months[dateFromKey(r.date).getMonth()].slice(0,3)}</small></span>
      <span><strong>${escapeHtml(names.join(" + "))}</strong><small>${escapeHtml(prettyDate(r.date))}</small></span>
      <span>›</span>
    </button>`;
  }).join("");
  document.querySelectorAll(".reservation-row").forEach(b=>b.addEventListener("click",()=>selectDate(b.dataset.date)));
}

$("prevMonth").addEventListener("click",()=>{state.current.setMonth(state.current.getMonth()-1);renderCalendar();});
$("nextMonth").addEventListener("click",()=>{state.current.setMonth(state.current.getMonth()+1);renderCalendar();});
$("todayBtn").addEventListener("click",()=>{state.current=new Date();state.selected=keyDate(new Date());renderCalendar();});
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
