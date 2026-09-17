/** Minimal fakes of GmailApp, DriveApp, Utilities, PropertiesService, Session, Logger and MailApp for testing receipts-to-drive.gs in Node. */
// minimal fakes of GmailApp, DriveApp, Utilities, PropertiesService, Session, Logger, MailApp
module.exports = function(opts){
  const g = {};
  const props = {}; const logs = []; const mails = [];
  let fid = 0;
  function Folder(name, parent){ this.id='F'+(fid++); this.name=name; this.files=[]; this.folders=[]; this.parent=parent; }
  Folder.prototype = {
    getId(){return this.id}, getUrl(){return 'url:'+this.name},
    getFoldersByName(n){ const a=this.folders.filter(f=>f.name===n); let i=0; return {hasNext:()=>i<a.length,next:()=>a[i++]}; },
    getFolders(){ const a=this.folders.slice(); let i=0; return {hasNext:()=>i<a.length,next:()=>a[i++]}; },
    createFolder(n){ const f=new Folder(n,this); this.folders.push(f); allFolders[f.id]=f; return f; },
    getFilesByName(n){ const a=this.files.filter(f=>f.name===n); let i=0; return {hasNext:()=>i<a.length,next:()=>a[i++]}; },
    getFiles(){ const a=this.files.slice(); let i=0; return {hasNext:()=>i<a.length,next:()=>a[i++]}; },
    createFile(blob){ const f={name:blob.name, getName(){return this.name}, getDateCreated(){return new Date('2026-09-10')}, folder:this, moveTo(t){ if(this.locked) throw new Error('no access'); this.folder.files=this.folder.files.filter(x=>x!==this); t.files.push(this); this.folder=t; } }; this.files.push(f); return f; },
    addFile(f){ if(f.locked) throw new Error('no access'); }, removeFile(f){}
  };
  const allFolders = {};
  const root = new Folder('Receipts', null); allFolders[root.id]=root; allFolders['FAKE_ROOT_FOLDER_ID']=root;
  const inbox = root.createFolder('_INBOX'); allFolders['FAKE_INBOX_FOLDER_ID']=inbox;
  const threads = opts.threads; // [{id, messages:[{id,date,subject,from,atts:[{name,type,size}]}], labels:[]}]
  g.threadsState = threads;
  g.GmailApp = {
    getUserLabelByName(){ return {name:'L'} }, createLabel(){ return {name:'L'} },
    search(q, start, max){
      g.lastQuery = q;
      const after = /after:(\d+)/.exec(q); const aft = after ? Number(after[1])*1000 : 0;
      const excludeLabel = /-label:/.test(q);
      let res = threads.filter(t => t.messages.some(m => (!aft || m.date.getTime() >= aft) && m.atts.length) && !(excludeLabel && t.labeled));
      if (/filename:pdf/.test(q) && !/filename:jpg/.test(q)) res = res.filter(t=>t.messages.some(m=>m.atts.some(a=>/pdf/.test(a.type))));
      else if (/filename:pdf/.test(q)) res = res.filter(t=>t.messages.some(m=>m.atts.some(a=>/pdf|image/.test(a.type))));
      res = res.sort((a,b)=>Math.max(...b.messages.map(m=>m.date))-Math.max(...a.messages.map(m=>m.date)));
      return res.slice(start, start+max).map(t=>({
        getMessages:()=>t.messages.map(m=>({ getId:()=>m.id, getDate:()=>m.date, getSubject:()=>m.subject, getFrom:()=>m.from,
          getAttachments:()=>m.atts.map(a=>({getName:()=>a.name,getContentType:()=>a.type,getSize:()=>a.size||1000,copyBlob:()=>({name:a.name,setName(n){this.name=n;return this}})})) })),
        addLabel:()=>{ t.labeled=true; }
      }));
    }
  };
  g.DriveApp = { getFolderById:(id)=>allFolders[id], getRootFolder:()=>({getFoldersByName:()=>({hasNext:()=>true,next:()=>root}), createFolder:()=>root}) };
  g.Utilities = { formatDate:(d,tz,f)=> f==='yyyy-MM'? d.toISOString().slice(0,7) : d.toISOString().slice(0,10) };
  const store = { getProperty:k=>props[k]||null, setProperty:(k,v)=>{props[k]=v} };
  g.PropertiesService = { getUserProperties:()=>store, getScriptProperties:()=>store };
  g.Session = { getScriptTimeZone:()=>'Europe/Copenhagen', getEffectiveUser:()=>({getEmail:()=>'me@x'}) };
  g.Logger = { log:(s)=>logs.push(s) };
  g.MailApp = { sendEmail:(...a)=>mails.push(a) };
  g.root=root; g.inbox=inbox; g.props=props; g.logs=logs; g.mails=mails;
  g.allNames = ()=>{ const out=[]; (function walk(f){ f.files.forEach(x=>out.push(f.name+'/'+x.name)); f.folders.forEach(walk); })(root); return out; };
  return g;
};
