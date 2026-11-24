/* NOVA Drive Dashboard
   Configure API_KEY, CLIENT_ID and ROOT_FOLDER_ID below.
   Admin writes use OAuth in the browser; never put a client secret here.
*/
const CONFIG = {
  API_KEY: "YOUR_GOOGLE_DRIVE_API_KEY",
  CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID",
  ROOT_FOLDER_ID: "YOUR_PUBLIC_FOLDER_ID",
  // Full Drive scope enables editing pre-existing files in the selected folder.
  // Review Google's OAuth verification requirements before publishing broadly.
  SCOPES: "https://www.googleapis.com/auth/drive"
};

const state = { files: [], folderId: CONFIG.ROOT_FOLDER_ID, folderStack: [], tokenClient: null, accessToken: null, isAdmin: false, syncTimer: null };
const $ = (s) => document.querySelector(s);
const fmtDate = (v) => v ? new Date(v).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "—";
const fmtSize = (n) => !n ? "—" : n < 1048576 ? `${(n/1024).toFixed(0)} KB` : `${(n/1048576).toFixed(1)} MB`;
const isFolder = f => f.mimeType === "application/vnd.google-apps.folder";
const isNote = f => f.name?.toLowerCase().endsWith(".txt") && f.name?.toLowerCase().includes("note");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const toast = msg => { const t=$("#toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2800); };

function showView(name){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $("#crumb-current").textContent = name.charAt(0).toUpperCase()+name.slice(1);
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));

function initAuth(){
  if(!window.google?.accounts?.oauth2){setTimeout(initAuth,300);return;}
  if(!CONFIG.CLIENT_ID.startsWith("YOUR_")){
    state.tokenClient=google.accounts.oauth2.initTokenClient({
      client_id:CONFIG.CLIENT_ID,scope:CONFIG.SCOPES,
      callback: async (response)=> {
        if(response.error){toast("Google sign-in failed: "+response.error);return;}
        state.accessToken=response.access_token;state.isAdmin=true;
        $("#login-btn").textContent="✓ Admin connected";$("#auth-status").textContent="Administrator";
        toast("Admin access enabled");await loadDriveFiles();
      }
    });
  }
}
$("#login-btn").addEventListener("click",()=>{
  if(!state.tokenClient){toast("Add your Google OAuth Client ID in app.js first.");return;}
  state.tokenClient.requestAccessToken({prompt:state.accessToken?"":"consent"});
});

async function driveRequest(path, options={}){
  const headers = new Headers(options.headers||{});
  if(state.accessToken) headers.set("Authorization",`Bearer ${state.accessToken}`);
  if(!options.noKey && CONFIG.API_KEY && !CONFIG.API_KEY.startsWith("YOUR_")) path += (path.includes("?")?"&":"?")+"key="+encodeURIComponent(CONFIG.API_KEY);
  const res=await fetch("https://www.googleapis.com/drive/v3/"+path,{...options,headers});
  if(!res.ok){const body=await res.json().catch(()=>({}));throw new Error(body.error?.message||`Drive API error ${res.status}`);}
  if(res.status===204)return null;
  return res.json();
}
async function loadDriveFiles(){
  if(!CONFIG.ROOT_FOLDER_ID || CONFIG.ROOT_FOLDER_ID.startsWith("YOUR_")){toast("Set ROOT_FOLDER_ID in app.js to connect your folder.");return;}
  try{
    $("#sync-label").textContent="Syncing with Google Drive…";
    const q=encodeURIComponent(`'${state.folderId}' in parents and trashed = false`);
    const fields=encodeURIComponent("files(id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink,iconLink,description),nextPageToken");
    const data=await driveRequest(`files?q=${q}&pageSize=100&orderBy=modifiedTime%20desc&fields=${fields}`);
    state.files=data.files||[];
    renderAll();
    const now=new Date();$("#sync-label").textContent="Synced "+now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    $("#stat-sync").textContent=now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  }catch(e){$("#sync-label").textContent="Drive connection issue";toast(e.message);}
}
function iconFor(f){if(isFolder(f))return ["▣","folder"];if(f.mimeType?.startsWith("image/"))return ["▧","image"];if(f.mimeType?.includes("pdf"))return ["▤","pdf"];if(isNote(f))return ["✎","note"];return ["▤","doc"];}
function renderAll(){
  const files=state.files, folders=files.filter(isFolder), notes=files.filter(isNote), regular=files.filter(f=>!isFolder(f)&&!isNote(f));
  $("#stat-files").textContent=regular.length;$("#stat-folders").textContent=folders.length;$("#stat-notes").textContent=notes.length;
  $("#chart-total").textContent=files.length;
  const docs=regular.filter(f=>!f.mimeType?.startsWith("image/")&&!f.mimeType?.startsWith("video/")).length;
  const media=regular.length-docs,other=0;
  $("#count-docs").textContent=docs;$("#count-media").textContent=media;$("#count-other").textContent=other;
  const total=Math.max(files.length,1),a=docs/total*100,b=media/total*100;
  $("#donut-chart").style.background=`conic-gradient(var(--purple) 0 ${a}%,var(--cyan) ${a}% ${a+b}%,var(--pink) ${a+b}% 100%)`;
  $("#recent-list").innerHTML=files.slice(0,5).map(fileRow).join("")||empty("No files in this folder","Upload a file or create a folder to get started.");
  $("#all-files").innerHTML=files.map(fileCard).join("")||empty("This folder is empty","Upload a file or create a folder to get started.");
  $("#notes-grid").innerHTML=notes.map(f=>`<article class="note-card"><h3>${esc(f.name)}</h3><p>Saved in Google Drive. Open the file to read or edit its contents.</p><small>Updated ${fmtDate(f.modifiedTime)}</small><div class="card-actions"><button onclick="openDrive('${f.id}')">Open</button><button onclick="renameFile('${f.id}','${esc(f.name)}')">Rename</button></div></article>`).join("")||empty("No notes yet","Create a note to save it in this Google Drive folder.");
  $("#activity-list").innerHTML=files.slice(0,12).map(f=>`<div class="activity-row"><i class="activity-dot"></i><div><b>${esc(f.name)}</b><small>${isFolder(f)?"Folder":"File"} · Modified ${fmtDate(f.modifiedTime)}</small></div></div>`).join("")||empty("No activity to show","Drive changes will appear here after connection.");
  $("#folder-path").innerHTML=`◈ <b>${esc(state.folderStack.map(x=>x.name).join(" / ")||"All files")}</b>`;
  $("#storage-caption").textContent=`${files.length} items in current folder`;
}
function fileRow(f){const [icon,type]=iconFor(f);return `<div class="file-row"><div class="file-type ${type}">${icon}</div><div class="file-info"><b>${esc(f.name)}</b><small>${isFolder(f)?"Folder":fmtSize(Number(f.size))} · ${fmtDate(f.modifiedTime)}</small></div><span class="file-size">${isFolder(f)?"Folder":"Drive file"}</span></div>`;}
function fileCard(f){const [icon,type]=iconFor(f);return `<article class="drive-card"><div class="drive-card-top"><div class="file-type ${type}">${icon}</div><span class="file-size">${isFolder(f)?"FOLDER":fmtSize(Number(f.size))}</span></div><h3 title="${esc(f.name)}">${esc(f.name)}</h3><p>Modified ${fmtDate(f.modifiedTime)}</p><div class="card-actions">${isFolder(f)?`<button onclick="openFolder('${f.id}','${esc(f.name)}')">Open folder</button>`:`<button onclick="openDrive('${f.id}')">Open</button>`}${state.isAdmin?`<button onclick="renameFile('${f.id}','${esc(f.name)}')">Rename</button><button onclick="deleteFile('${f.id}')">Delete</button>`:""}</div></article>`;}
function empty(title,desc){return `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">✦</div><b>${title}</b><p>${desc}</p></div>`;}
window.openDrive=id=>{const f=state.files.find(x=>x.id===id);if(f?.webViewLink)window.open(f.webViewLink,"_blank","noopener");else window.open(`https://drive.google.com/file/d/${id}/view`,"_blank","noopener");};
window.openFolder=async(id,name)=>{state.folderStack.push({id:state.folderId,name});state.folderId=id;await loadDriveFiles();};
window.renameFile=async(id,old)=>{if(!state.isAdmin)return toast("Sign in as admin first.");const name=prompt("New name:",old);if(!name||name===old)return;try{await driveRequest(`files/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});toast("File renamed");loadDriveFiles();}catch(e){toast(e.message);}};
window.deleteFile=async id=>{if(!state.isAdmin)return toast("Sign in as admin first.");if(!confirm("Move this item to trash?"))return;try{await driveRequest(`files/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({trashed:true})});toast("Moved to Drive trash");loadDriveFiles();}catch(e){toast(e.message);}};
async function createFolder(name){await driveRequest("files",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder",parents:[state.folderId]})});toast("Folder created");loadDriveFiles();}
async function uploadFiles(fileList){for(const file of fileList){const metadata={name:file.name,parents:[state.folderId]};const boundary="nova_"+Math.random().toString(16).slice(2);const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.type||"application/octet-stream"}\r\n\r\n`,file,`\r\n--${boundary}--`]);await driveRequest("files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink",{method:"POST",headers:{"Content-Type":`multipart/related; boundary=${boundary}`},body});}toast(`${fileList.length} file(s) uploaded`);loadDriveFiles();}
function openModal(title,description,fields,submit){const modal=$("#modal");modal.innerHTML=`<h2>${title}</h2><p>${description}</p>${fields}<div class="modal-actions"><button class="secondary-btn" id="modal-cancel">Cancel</button><button class="primary-btn" id="modal-save">Save</button></div>`;$("#modal-backdrop").classList.add("show");$("#modal-cancel").onclick=closeModal;$("#modal-save").onclick=async()=>{try{await submit();closeModal();}catch(e){toast(e.message);}};}
function closeModal(){$("#modal-backdrop").classList.remove("show");}
$("#modal-backdrop").addEventListener("click",e=>{if(e.target.id==="modal-backdrop")closeModal();});
function requireAdmin(){if(!state.isAdmin){toast("Sign in as administrator to make changes.");return false;}return true;}
function askFolder(){if(!requireAdmin())return;openModal("Create a folder","Add a new folder to the current Drive location.",`<label>Folder name</label><input id="folder-name" placeholder="e.g. Research resources">`,async()=>{const n=$("#folder-name").value.trim();if(!n)throw Error("Enter a folder name.");await createFolder(n);});}
function askNote(){if(!requireAdmin())return;openModal("Write a note","Your note will be saved as a text file in this Drive folder.",`<label>Title</label><input id="note-title" placeholder="Note title"><label>Note</label><textarea id="note-body" placeholder="Write your thoughts..."></textarea>`,async()=>{const name=$("#note-title").value.trim(),content=$("#note-body").value;if(!name)throw Error("Enter a title.");const boundary="nova_"+Math.random().toString(16).slice(2),blob=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name:name+".txt",mimeType:"text/plain",parents:[state.folderId]})}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`,content,`\r\n--${boundary}--`]);await driveRequest("files?uploadType=multipart",{method:"POST",headers:{"Content-Type":`multipart/related; boundary=${boundary}`},body:blob});toast("Note saved to Drive");loadDriveFiles();});}
$("#new-folder-btn").onclick=askFolder;$("#new-note-btn").onclick=askNote;
document.querySelectorAll('[data-action="folder"]').forEach(b=>b.onclick=askFolder);
document.querySelectorAll('[data-action="note"]').forEach(b=>b.onclick=askNote);
$("#upload-btn").onclick=()=>requireAdmin()&&$("#file-input").click();
document.querySelector('[data-action="upload"]').onclick=()=>requireAdmin()&&$("#file-input").click();
$("#file-input").onchange=e=>{if(e.target.files.length)uploadFiles([...e.target.files]).catch(err=>toast(err.message));e.target.value="";};
$("#refresh-btn").onclick=loadDriveFiles;
$("#global-search").addEventListener("input",e=>{const q=e.target.value.toLowerCase();const filtered=state.files.filter(f=>f.name.toLowerCase().includes(q));$("#all-files").innerHTML=filtered.map(fileCard).join("")||empty("No matching files","Try another search term.");if(q)showView("files");});
initAuth();
if(CONFIG.ROOT_FOLDER_ID&&!CONFIG.ROOT_FOLDER_ID.startsWith("YOUR_"))loadDriveFiles();
state.syncTimer=setInterval(()=>{if(CONFIG.ROOT_FOLDER_ID&&!CONFIG.ROOT_FOLDER_ID.startsWith("YOUR_"))loadDriveFiles();},60000);
