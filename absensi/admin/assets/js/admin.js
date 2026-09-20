import {initializeApp,getApps} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";import{getAuth,GoogleAuthProvider,signInWithRedirect,getRedirectResult}from"https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
const CONFIG={WEB_APP_URL:"https://script.google.com/macros/s/AKfycbwgDEVMNm9RccxlYqfIek-8JU7asOyqBTiRohKQUV8FgYLW7uxhNAcr-nvabQxhxuBW/exec",FIREBASE_CONFIG:{apiKey:"AIzaSyAHU_FdW5CGZ_iR19sx9QyPhpem5YbLQe8",authDomain:"absensiamil.firebaseapp.com",projectId:"absensiamil",storageBucket:"absensiamil.firebasestorage.app",messagingSenderId:"962926272481",appId:"1:962926272481:web:d6d5bae6d890ebecc2bca0"}};
let sessionToken=localStorage.getItem("absen_admin_session")||"",user=null,requests=[],employees=[],selected=null;
const $=id=>document.getElementById(id); const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function id(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"_"+Math.random().toString(36).slice(2)}
function toast(m){const x=$("toast");x.textContent=m;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),2600)}
function postForm(data){return new Promise(resolve=>{const rid=data.requestId||id();const form=document.createElement("form");form.method="POST";form.action=CONFIG.WEB_APP_URL;form.target="admin_api_"+rid;const iframe=document.createElement("iframe");iframe.name="admin_api_"+rid;iframe.style.display="none";document.body.appendChild(iframe);Object.entries({...data,requestId:rid}).forEach(([k,v])=>{const i=document.createElement("input");i.name=k;i.value=v??"";form.appendChild(i)});document.body.appendChild(form);form.submit();setTimeout(()=>{form.remove();iframe.remove();resolve(true)},650)})}
async function request(action,extra={}){const rid=id();await postForm({action,requestId:rid,sessionToken,...extra});return new Promise(resolve=>{let n=0;const poll=()=>{const s=document.createElement("script");s.src=CONFIG.WEB_APP_URL+"?action=status&requestId="+encodeURIComponent(rid)+"&callback=__admin_cb"+rid.replace(/-/g,"")+"&_="+Date.now();window[s.src.split("callback=")[1].split("&")[0]]=r=>{delete window[s.src.split("callback=")[1].split("&")[0]];s.remove();if(r?.state==="DONE"||r?.ok===false)resolve(r);else if(n++<15)setTimeout(poll,500);else resolve({ok:false,error:"Server timeout"})};document.body.appendChild(s)};setTimeout(poll,350)})}
async function login(){
  try{
    $("loginBtn").disabled=true;
    const app=getApps().length?getApps()[0]:initializeApp(CONFIG.FIREBASE_CONFIG);
    const auth=getAuth(app);
    const provider=new GoogleAuthProvider();
    provider.setCustomParameters({prompt:"select_account"});
    await signInWithRedirect(auth,provider);
  }catch(e){
    console.error("ADMIN LOGIN REDIRECT ERROR:",e);
    toast(e?.message||"Login Google gagal");
    $("loginBtn").disabled=false;
  }
}

async function handleRedirectLogin(){
  try{
    const app=getApps().length?getApps()[0]:initializeApp(CONFIG.FIREBASE_CONFIG);
    const auth=getAuth(app);
    const result=await getRedirectResult(auth);
    if(!result?.user) return;

    $("loginBtn").disabled=true;
    const token=await result.user.getIdToken(true);
    const r=await request("firebaseLogin",{firebaseIdToken:token});
    if(!r?.ok) throw Error(r?.error||r?.message||"Login gagal");

    sessionToken=r.session?.token||r.sessionToken||r.data?.sessionToken||"";
    if(!sessionToken) throw Error("Session admin tidak diterima");

    localStorage.setItem("absen_admin_session",sessionToken);
    await restore();
  }catch(e){
    console.error("ADMIN REDIRECT RESULT ERROR:",e);
    localStorage.removeItem("absen_admin_session");
    toast(e?.message||"Login admin gagal");
  }finally{
    $("loginBtn").disabled=false;
  }
}

async function restore(){if(!sessionToken)return;const r=await request("profile");if(!r?.ok)throw Error(r?.error||"Session tidak valid");user=r.user||r.data?.user; if(String(user?.role||"").toUpperCase()!=="ADMIN")throw Error("Akun bukan ADMIN");$("login").classList.add("hidden");$("app").classList.remove("hidden");$("adminName").textContent=user.name||user.email||"Admin";if(user.photo)$("avatar").src=user.photo;loadRequests();loadEmployees()}
async function loadRequests(){const r=await request("adminRequests",{status:$('statusFilter').value,type:$('typeFilter').value});if(!r?.ok){toast(r?.error||"Gagal memuat pengajuan");return}requests=r.items||[];renderRequests()}
function renderRequests(){const el=$("requestList");if(!requests.length){el.innerHTML='<div class="meta">Tidak ada pengajuan.</div>';return}el.innerHTML=requests.map((x,i)=>`<div class="item"><div><h3>${esc(x.name)} · ${esc(x.type)}</h3><div class="meta">${esc(x.startDate)}${x.endDate&&x.endDate!==x.startDate?' s/d '+esc(x.endDate):''} · ${esc(x.days)} hari · ${esc(x.reason)}</div><div class="meta">${esc(x.nip||x.email)} · diajukan ${esc(x.timestamp)}</div></div><div><span class="badge ${x.status==='DISETUJUI'?'ok':x.status==='DITOLAK'?'no':''}">${esc(x.status)}</span><br><button data-i="${i}">Detail</button></div></div>`).join('');el.querySelectorAll('button').forEach(b=>b.onclick=()=>openRequest(requests[+b.dataset.i]))}
function openRequest(x){selected=x;$("modalTitle").textContent=`${x.type} · ${x.name}`;$("modalBody").innerHTML=`<div class="detail"><b>Nama</b><span>${esc(x.name)}</span><b>NIP</b><span>${esc(x.nip)}</span><b>Email</b><span>${esc(x.email)}</span><b>Jenis</b><span>${esc(x.type)}</span><b>Tanggal</b><span>${esc(x.startDate)}${x.endDate!==x.startDate?' s/d '+esc(x.endDate):''}</span><b>Jumlah</b><span>${esc(x.days)} hari</span><b>Alasan</b><span>${esc(x.reason)}</span><b>Status</b><span>${esc(x.status)}</span></div><textarea id="reviewNote" placeholder="Catatan admin (opsional)" maxlength="500" style="width:100%;margin-top:18px;padding:10px;border:1px solid #d9e2ef;border-radius:9px;min-height:90px"></textarea>`;const pending=x.status.toUpperCase()==='MENUNGGU';$("approveBtn").style.display=pending?'':'none';$("rejectBtn").style.display=pending?'':'none';$("modal").classList.remove("hidden")}
async function review(decision){if(!selected)return;const note=$("reviewNote")?.value||"";const r=await request("adminReviewRequest",{requestId:selected.requestId,decision,note});if(!r?.ok){toast(r?.error||"Gagal memproses");return}$("modal").classList.add("hidden");toast(r.message||"Berhasil");loadRequests()}
async function loadEmployees(){const r=await request("adminEmployees");if(!r?.ok)return;employees=r.items||[];$("employeeSelect").innerHTML='<option value="">Pilih pegawai...</option>'+employees.filter(e=>String(e.status||'AKTIF').toUpperCase()==='AKTIF').map(e=>`<option value="${esc(e.uid)}">${esc(e.name)} — ${esc(e.nip||e.email)}</option>`).join('')}
async function createAssignment(e){e.preventDefault();const uid=$("employeeSelect").value;if(!uid){toast("Pilih pegawai");return}const r=await request("adminCreateAssignment",{uid,title:$("title").value,description:$("description").value,startDate:$("startDate").value,endDate:$("endDate").value,location:$("location").value,priority:$("priority").value,notes:$("notes").value});if(!r?.ok){toast(r?.error||"Gagal membuat penugasan");return}e.target.reset();toast("Penugasan berhasil diberikan")}
function tab(name){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));$("requests").classList.toggle('hidden',name!=="requests");$("assignment").classList.toggle('hidden',name!=="assignment")}
$("loginBtn").onclick=login;$("logoutBtn").onclick=()=>{localStorage.removeItem("absen_admin_session");location.reload()};$("refreshBtn").onclick=loadRequests;$("statusFilter").onchange=loadRequests;$("typeFilter").onchange=loadRequests;$("closeModal").onclick=()=>$("modal").classList.add("hidden");$("approveBtn").onclick=()=>review("DISETUJUI");$("rejectBtn").onclick=()=>review("DITOLAK");$("assignmentForm").onsubmit=createAssignment;document.querySelectorAll('.tab').forEach(x=>x.onclick=()=>tab(x.dataset.tab));handleRedirectLogin().finally(()=>{restore().catch(e=>{console.warn('RESTORE ADMIN:',e);localStorage.removeItem('absen_admin_session')})});
