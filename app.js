// ═══════════════════════════════════════════════════
//  SHAREDROP — app.js
//  Firebase: Auth · Firestore · Storage
//
//  SETUP CHECKLIST (Firebase Console):
//   1. Authentication → Sign-in method → Enable Google
//   2. Add your domain to Authorized Domains
//   3. Firestore Database → Create database (test mode to start)
//   4. Storage → Get started (test mode to start)
//
//  Suggested Firestore rules:
//   match /projects/{pid} {
//     allow read: if request.auth != null &&
//       (request.auth.uid == resource.data.owner ||
//        request.auth.token.email in resource.data.members);
//     allow create: if request.auth != null;
//     allow update: if request.auth != null &&
//       request.auth.uid == resource.data.owner;
//     match /files/{fid} { allow read, write: if request.auth != null; }
//   }
// ═══════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc,
  query, where, onSnapshot, serverTimestamp, arrayUnion, orderBy
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ─── FIREBASE INIT ───────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDN8Ql4rNYfCfS2_XsQhIbQHr4GFPJIZx4",
  authDomain:        "ardy-yap-app.firebaseapp.com",
  projectId:         "ardy-yap-app",
  storageBucket:     "ardy-yap-app.firebasestorage.app",
  messagingSenderId: "76536967054",
  appId:             "1:76536967054:web:a44a8175b3ee04ccd3bedf",
  measurementId:     "G-E7V3L9PC7H"
};

const fbApp   = initializeApp(firebaseConfig);
const auth    = getAuth(fbApp);
const db      = getFirestore(fbApp);
const storage = getStorage(fbApp);

// ─── STATE ───────────────────────────────────────
let currentUser     = null;
let currentProjId   = null;
let currentProjData = null;
let filesUnsub      = null;
let toastTimer      = null;

// ─── DOM REFS ─────────────────────────────────────
const $ = id => document.getElementById(id);

const authScreen   = $('auth-screen');
const appScreen    = $('app-screen');
const googleBtn    = $('google-btn');
const signoutBtn   = $('signout-btn');
const userPhoto    = $('user-photo');
const userNameEl   = $('user-name');
const tabNav       = $('tab-nav');
const tabBar       = $('tab-bar');
const gridMine     = $('grid-mine');
const gridShared   = $('grid-shared');
const newProjBtn   = $('new-project-btn');
const inpName      = $('inp-name');
const inpDesc      = $('inp-desc');
const btnCreate    = $('btn-create');
const dropZone     = $('drop-zone');
const fileInp      = $('file-inp');
const browseFiles  = $('browse-files');
const fileList     = $('file-list');
const memberList   = $('member-list');
const inviteBlock  = $('invite-block');
const inpEmail     = $('inp-email');
const btnAdd       = $('btn-add');
const inviteMsg    = $('invite-msg');
const projName     = $('proj-name');
const projDescLbl  = $('proj-desc-label');
const toast        = $('toast');

// ─── TOAST ────────────────────────────────────────
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ─── OVERLAYS ─────────────────────────────────────
function openOverlay(id) { $(id).classList.add('open'); }

function closeOverlay(id) {
  $(id).classList.remove('open');
  if (id === 'ov-proj' && filesUnsub) {
    filesUnsub();
    filesUnsub = null;
    currentProjId = null;
    currentProjData = null;
  }
}

// Delegate close to [data-close] buttons + clicking backdrop
document.addEventListener('click', e => {
  const closer = e.target.closest('[data-close]');
  if (closer) { closeOverlay(closer.dataset.close); return; }
  if (e.target.classList.contains('overlay')) {
    closeOverlay(e.target.id);
  }
});

// ─── AUTH ─────────────────────────────────────────
googleBtn.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    showToast('Sign-in failed. Try again.');
    console.error(err);
  }
});

signoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) {
    authScreen.classList.remove('active');
    appScreen.classList.add('active');
    if (user.photoURL) {
      userPhoto.src = user.photoURL;
      userPhoto.classList.add('visible');
    }
    userNameEl.textContent = user.displayName || user.email;
    loadMyProjects();
    loadSharedProjects();
    // Init tab indicator after DOM settles
    setTimeout(syncTabBar, 80);
  } else {
    authScreen.classList.add('active');
    appScreen.classList.remove('active');
  }
});

// ─── TABS ─────────────────────────────────────────
function syncTabBar() {
  const active = tabNav.querySelector('.tab-item.active');
  if (!active) return;
  const navLeft = tabNav.getBoundingClientRect().left;
  const btnRect = active.getBoundingClientRect();
  tabBar.style.left  = (btnRect.left - navLeft) + 'px';
  tabBar.style.width = btnRect.width + 'px';
}

tabNav.addEventListener('click', e => {
  const btn = e.target.closest('.tab-item');
  if (!btn) return;
  tabNav.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const paneId = 'pane-' + btn.dataset.tab;
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  $(paneId).classList.add('active');
  syncTabBar();
});

window.addEventListener('resize', syncTabBar);

// ─── NEW PROJECT ──────────────────────────────────
newProjBtn.addEventListener('click', () => {
  inpName.value = '';
  inpDesc.value = '';
  openOverlay('ov-new');
  setTimeout(() => inpName.focus(), 120);
});

btnCreate.addEventListener('click', createProject);
inpName.addEventListener('keydown', e => e.key === 'Enter' && createProject());

async function createProject() {
  const name = inpName.value.trim();
  if (!name) { inpName.focus(); inpName.style.borderColor = '#f87171'; return; }
  inpName.style.borderColor = '';

  btnCreate.disabled = true;
  btnCreate.textContent = 'Creating…';

  try {
    await addDoc(collection(db, 'projects'), {
      name,
      description: inpDesc.value.trim(),
      owner:       currentUser.uid,
      ownerEmail:  currentUser.email,
      members:     [],
      fileCount:   0,
      createdAt:   serverTimestamp()
    });
    closeOverlay('ov-new');
    showToast('✓ Project created!');
  } catch (err) {
    showToast('Failed to create project.');
    console.error(err);
  } finally {
    btnCreate.disabled = false;
    btnCreate.textContent = 'Create';
  }
}

// ─── LOAD PROJECTS ────────────────────────────────
function loadMyProjects() {
  const q = query(collection(db, 'projects'), where('owner', '==', currentUser.uid));
  onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderGrid(gridMine, list, true);
  });
}

function loadSharedProjects() {
  const q = query(collection(db, 'projects'), where('members', 'array-contains', currentUser.email));
  onSnapshot(q, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderGrid(gridShared, list, false);
  });
}

// ─── RENDER GRID ──────────────────────────────────
function renderGrid(grid, projects, isMine) {
  grid.innerHTML = '';
  if (projects.length === 0) {
    const msg = isMine ? 'No projects yet — create one!' : 'Nothing shared with you yet.';
    grid.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 72 72" fill="none">
          <path d="M54 32C54 23.16 46.84 16 38 16C32.58 16 27.76 18.82 25.04 23.12C18.34 23.38 13 28.83 13 35.5C13 42.4 18.6 48 25.5 48H54C59.52 48 64 43.52 64 38C64 32.64 59.73 28.33 54.43 28.08C54.16 29.38 54 30.68 54 32Z"
            fill="#dbeafe" stroke="#93c5fd" stroke-width="1.5"/>
          <path d="M46 40L38 32L30 40" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="38" y1="32" x2="38" y2="54" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <p>${msg}</p>
      </div>`;
    return;
  }
  projects.forEach((proj, i) => {
    const card = buildCard(proj, isMine, i);
    grid.appendChild(card);
  });
}

// ─── BUILD PROJECT CARD ───────────────────────────
function buildCard(proj, isMine, delay) {
  const date = proj.createdAt?.seconds
    ? new Date(proj.createdAt.seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Just now';

  const card = document.createElement('div');
  card.className = 'proj-card';
  card.style.animationDelay = (delay * 55) + 'ms';
  card.innerHTML = `
    <div class="card-ico">
      <svg viewBox="0 0 22 22" fill="none">
        <path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z"
          fill="#dbeafe" stroke="#3b82f6" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="card-name">${esc(proj.name)}</div>
    <div class="card-meta">${date}</div>
    ${!isMine ? `<div class="card-owner">by ${esc(proj.ownerEmail || 'unknown')}</div>` : ''}
  `;
  card.addEventListener('click', () => openProject(proj));
  return card;
}

// ─── OPEN PROJECT MODAL ───────────────────────────
function openProject(proj) {
  currentProjId   = proj.id;
  currentProjData = { ...proj };
  const isOwner   = proj.owner === currentUser.uid;

  projName.textContent     = proj.name;
  projDescLbl.textContent  = proj.description || '';
  inviteBlock.style.display = isOwner ? '' : 'none';

  renderMembers(currentProjData);
  startFileListener(proj.id);
  openOverlay('ov-proj');
}

// ─── FILES LISTENER ───────────────────────────────
function startFileListener(projId) {
  if (filesUnsub) filesUnsub();
  fileList.innerHTML = '<p class="empty-files">Loading…</p>';

  // Fallback: no orderBy (avoids needing a composite index)
  const colRef = collection(db, 'projects', projId, 'files');
  filesUnsub = onSnapshot(colRef, snap => {
    const files = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.uploadedAt?.seconds || 0) - (a.uploadedAt?.seconds || 0));
    renderFiles(files);
  });
}

function renderFiles(files) {
  fileList.innerHTML = '';
  if (files.length === 0) {
    fileList.innerHTML = '<p class="empty-files">No files yet — upload something!</p>';
    return;
  }
  files.forEach((f, i) => {
    const row = buildFileRow(f, i);
    fileList.appendChild(row);
  });
}

function buildFileRow(file, delay) {
  const size  = formatBytes(file.size || 0);
  const date  = file.uploadedAt?.seconds
    ? new Date(file.uploadedAt.seconds * 1000).toLocaleDateString()
    : '';
  const row   = document.createElement('div');
  row.className = 'file-row';
  row.style.animationDelay = delay * 35 + 'ms';
  row.innerHTML = `
    <div class="file-ico">${fileIcon(file.name)}</div>
    <div class="file-info">
      <div class="file-name">${esc(file.name)}</div>
      <div class="file-meta">${size}${date ? ' · ' + date : ''}</div>
    </div>
    <button class="dl-btn" title="Download">
      <svg viewBox="0 0 18 18" fill="none">
        <path d="M9 3v9M5 8l4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 15h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
    </button>`;
  row.querySelector('.dl-btn').addEventListener('click', () => {
    if (file.downloadURL) {
      const a = document.createElement('a');
      a.href = file.downloadURL;
      a.download = file.name;
      a.target = '_blank';
      a.click();
    }
  });
  return row;
}

// ─── UPLOAD ───────────────────────────────────────
dropZone.addEventListener('click', e => {
  if (!e.target.closest('.dl-btn')) fileInp.click();
});

browseFiles.addEventListener('click', e => {
  e.stopPropagation();
  fileInp.click();
});

fileInp.addEventListener('change', e => handleUpload(e.target.files));

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleUpload(e.dataTransfer.files);
});

function handleUpload(files) {
  if (!currentProjId || !files.length) return;
  // Clear the "no files" message if present
  const emptyMsg = fileList.querySelector('.empty-files');
  if (emptyMsg) emptyMsg.remove();
  Array.from(files).forEach(uploadOne);
  fileInp.value = '';
}

function uploadOne(file) {
  const progRow = document.createElement('div');
  progRow.className = 'prog-row';
  progRow.innerHTML = `
    <div class="prog-filename">${esc(file.name)}</div>
    <div class="prog-track"><div class="prog-fill"></div></div>`;
  fileList.prepend(progRow);

  const storagePath = `projects/${currentProjId}/${Date.now()}_${file.name}`;
  const sRef        = ref(storage, storagePath);
  const task        = uploadBytesResumable(sRef, file);

  task.on('state_changed',
    snap => {
      const pct = (snap.bytesTransferred / snap.totalBytes * 100).toFixed(0);
      progRow.querySelector('.prog-fill').style.width = pct + '%';
    },
    err => {
      progRow.remove();
      showToast('Upload failed: ' + err.message);
    },
    async () => {
      const downloadURL = await getDownloadURL(task.snapshot.ref);
      await addDoc(collection(db, 'projects', currentProjId, 'files'), {
        name:        file.name,
        size:        file.size,
        type:        file.type || 'application/octet-stream',
        downloadURL,
        uploadedAt:  serverTimestamp(),
        uploadedBy:  currentUser.email
      });
      progRow.remove();
      showToast(`✓ ${file.name} uploaded!`);
    }
  );
}

// ─── MEMBERS ──────────────────────────────────────
function renderMembers(proj) {
  memberList.innerHTML = '';
  // Owner first
  memberList.appendChild(buildMemberRow(proj.ownerEmail || 'Owner', true));
  // Other members
  (proj.members || []).forEach(email => {
    memberList.appendChild(buildMemberRow(email, false));
  });
}

function buildMemberRow(email, isOwner) {
  const row = document.createElement('div');
  row.className = 'member-row';
  const initial = (email || '?')[0].toUpperCase();
  row.innerHTML = `
    <div class="member-av">${initial}</div>
    <div class="member-email">${esc(email)}</div>
    ${isOwner ? '<span class="owner-tag">Owner</span>' : ''}`;
  return row;
}

btnAdd.addEventListener('click', addMember);
inpEmail.addEventListener('keydown', e => e.key === 'Enter' && addMember());

async function addMember() {
  const email = inpEmail.value.trim().toLowerCase();
  inviteMsg.className = 'invite-msg';
  inviteMsg.textContent = '';

  if (!email || !email.includes('@')) {
    inviteMsg.className = 'invite-msg err';
    inviteMsg.textContent = 'Enter a valid email.';
    return;
  }
  if (email === currentUser.email) {
    inviteMsg.className = 'invite-msg err';
    inviteMsg.textContent = "That's you!";
    return;
  }
  if ((currentProjData?.members || []).includes(email)) {
    inviteMsg.className = 'invite-msg err';
    inviteMsg.textContent = 'Already a member.';
    return;
  }

  btnAdd.disabled = true;
  try {
    await updateDoc(doc(db, 'projects', currentProjId), {
      members: arrayUnion(email)
    });
    currentProjData.members = [...(currentProjData.members || []), email];
    renderMembers(currentProjData);
    inpEmail.value = '';
    inviteMsg.className = 'invite-msg ok';
    inviteMsg.textContent = '✓ Invited!';
    setTimeout(() => { inviteMsg.textContent = ''; }, 2500);
  } catch (err) {
    inviteMsg.className = 'invite-msg err';
    inviteMsg.textContent = 'Failed to add member.';
    console.error(err);
  } finally {
    btnAdd.disabled = false;
  }
}

// ─── UTILS ────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function fileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const images  = ['jpg','jpeg','png','gif','webp','svg','avif','bmp'];
  const video   = ['mp4','mov','avi','mkv','webm','m4v'];
  const audio   = ['mp3','wav','ogg','flac','m4a','aac'];
  const code    = ['js','ts','jsx','tsx','py','html','css','json','xml','lua','sh','rb'];
  const archive = ['zip','rar','7z','tar','gz','tgz'];
  const doc     = ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md'];

  if (images.includes(ext))  return icImg();
  if (video.includes(ext))   return icVid();
  if (audio.includes(ext))   return icAudio();
  if (code.includes(ext))    return icCode();
  if (archive.includes(ext)) return icZip();
  if (doc.includes(ext))     return icDoc();
  return icFile();
}

const ic = (path) =>
  `<svg viewBox="0 0 18 18" fill="none" style="color:var(--blue)">${path}</svg>`;

const icFile  = () => ic(`<path d="M4 2h7l4 4v10H4V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 2v4h4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 9h6M6 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`);
const icImg   = () => ic(`<rect x="1" y="2" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><circle cx="5.5" cy="6.5" r="1.5" fill="currentColor"/><path d="M1 12l4-4 3 3 2-2 5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`);
const icVid   = () => ic(`<rect x="1" y="3" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M13 7l4-2v8l-4-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`);
const icAudio = () => ic(`<path d="M8 4L4 7H2v4h2l4 3V4z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 6a4 4 0 010 6M11 8a2 2 0 010 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`);
const icCode  = () => ic(`<path d="M6 5L2 9l4 4M12 5l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 3l-2 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`);
const icZip   = () => ic(`<rect x="2" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M2 8h14" stroke="currentColor" stroke-width="1.4"/><rect x="8" y="1" width="2" height="3" rx=".5" stroke="currentColor" stroke-width="1.4"/><path d="M9 8v4M8 10h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`);
const icDoc   = () => ic(`<path d="M3 2h9l4 4v12H3V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 2v4h4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 9h6M6 12h4M6 6h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`);
