/* =====================================================
   FreezeFelis — script.js  (V0.1)
   ===================================================== */

/* ---------- 1. YOUR SETTINGS ---------- */
const SUPABASE_URL = 'https://nyjasgfyfrkpjrrnklkm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cR28i7fxZ0I7P99QA69PVQ_ge-6CHQS';

const MAX_FILE_MB = 50;
const MAX_AVATAR_MB = 5;

/* ---------- 2. CONNECT TO SUPABASE ---------- */
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- 3. APP MEMORY ---------- */
let me = null;
let view = { type: 'latest' };
let data = { posts: [], scores: {}, myVotes: {}, mySaves: new Set(), commentCounts: {} };
let reportTarget = null;

/* ---------- 4. SMALL HELPERS ---------- */
const $ = (selector) => document.querySelector(selector);

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatDate(iso) {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function avatarHtml(profile, size = '') {
  const name = profile?.username || '?';
  if (profile?.avatar_url) {
    return `<img class="avatar ${size}" src="${esc(profile.avatar_url)}" alt="">`;
  }
  return `<span class="avatar ${size}">${esc(name.charAt(0).toUpperCase())}</span>`;
}

function setMsg(el, text, good = false) {
  el.textContent = text;
  el.className = 'form-msg' + (good ? ' good' : '');
}

function openDialog(id) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  document.getElementById(id).showModal();
}

function requireLogin() {
  if (me) return true;
  openDialog('login-dialog');
  return false;
}

/* ---------- 5. LOGIN STATE & HEADER ---------- */
async function setUser(user) {
  me = null;
  if (user) {
    let { data: profile } = await db.from('profiles').select('id, username').eq('id', user.id).single();

    if (!profile) {
      const fallbackName = 'user' + user.id.slice(0, 8);
      const { data: created, error } = await db
        .from('profiles')
        .insert({ id: user.id, username: user.user_metadata?.username || fallbackName })
        .select('id, username')
        .single();
      if (error) {
        alert('Could not set up your profile: ' + error.message);
      } else {
        profile = created;
      }
    }

    me = profile;
  }
  updateHeader();
  await loadFeed();
}

function updateHeader() {
  const area = $('#auth-area');
  if (me) {
    area.innerHTML = `
      <button class="link-btn" data-action="my-profile">${esc(me.username)}</button>
      <button class="btn" data-action="open-upload">+ Share something</button>
      <button class="btn ghost" data-action="logout">Log out</button>`;
  } else {
    area.innerHTML = `
      <button class="btn ghost" data-action="open-login">Log in</button>
      <button class="btn" data-action="open-signup">Join</button>`;
  }
  $('#tab-saved').hidden = !me;
}

function updateHeading() {
  $('#tab-latest').classList.toggle('active', view.type === 'latest');
  $('#tab-saved').classList.toggle('active', view.type === 'saved');
  if (view.type === 'latest') {
    $('#view-title').textContent = 'Latest Uploads';
    $('#view-sub').textContent = 'A space made for artists, people who genuinely love art. Whether you draw, paint, animate, sculpt, photograph, write, act, make music, create videos, or express yourself through any other form of art, you’re welcome here.';
  } else if (view.type === 'saved') {
    $('#view-title').textContent = 'Saved';
    $('#view-sub').textContent = 'Things you wanted to keep. Only you can see this.';
  } else {
    $('#view-title').textContent = `Posts by ${view.username}`;
    $('#view-sub').textContent = '';
  }
}

/* ---------- 6. PROFILE HEADER ---------- */
async function loadProfileHeader(userId) {
  const box = $('#profile-header');
  box.hidden = false;
  box.innerHTML = '<p class="note">Loading profile…</p>';

  const { data: profile, error } = await db
    .from('profiles')
    .select('id, username, bio, avatar_url')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    box.innerHTML = '<p class="note">Could not load this profile.</p>';
    return;
  }

  const [followerResult, followingResult] = await Promise.all([
    db.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', userId),
    db.from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);

  let iFollow = false;
  if (me && me.id !== userId) {
    const { data: row } = await db
      .from('follows')
      .select('follower_id')
      .eq('follower_id', me.id)
      .eq('following_id', userId)
      .maybeSingle();
    iFollow = !!row;
  }

  const own = me && me.id === userId;
  let actionHtml;
  if (own) {
    actionHtml = `<button class="btn ghost" data-action="edit-profile">Edit profile</button>`;
  } else if (me) {
    actionHtml = `<button class="btn ${iFollow ? 'ghost' : ''}" data-action="toggle-follow" data-user-id="${userId}" data-following="${iFollow}">${iFollow ? 'Following ✓' : 'Follow'}</button>`;
  } else {
    actionHtml = `<button class="btn ghost" data-action="open-login">Follow</button>`;
  }

  box.innerHTML = `
    <div class="profile-top">
      ${avatarHtml(profile, 'large')}
      <div class="profile-info">
        <h2 class="profile-username">${esc(profile.username)}</h2>
        ${profile.bio ? `<p class="profile-bio">${esc(profile.bio)}</p>` : ''}
        <div class="profile-counts">
          <span><strong>${followerResult.count || 0}</strong> followers</span>
          <span><strong>${followingResult.count || 0}</strong> following</span>
        </div>
      </div>
    </div>
    <div class="profile-actions">${actionHtml}</div>`;
}

async function toggleFollow(userId, wasFollowing) {
  if (!requireLogin()) return;
  let error;
  if (wasFollowing) {
    ({ error } = await db.from('follows').delete().eq('follower_id', me.id).eq('following_id', userId));
  } else {
    ({ error } = await db.from('follows').insert({ follower_id: me.id, following_id: userId }));
  }
  if (error) return alert(error.message);
  await loadProfileHeader(userId);
}

async function openEditProfile() {
  const { data: profile } = await db.from('profiles').select('bio').eq('id', me.id).single();
  $('#profile-bio').value = profile?.bio || '';
  $('#profile-avatar').value = '';
  setMsg($('#profile-msg'), '');
  openDialog('profile-dialog');
}

$('#profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!me) return;

  const msg = $('#profile-msg');
  const button = e.target.querySelector('button[type="submit"]');
  const bio = $('#profile-bio').value.trim();
  const file = $('#profile-avatar').files[0];

  button.disabled = true;
  setMsg(msg, 'Saving…', true);

  try {
    const updates = { bio };

    if (file) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('Please use a PNG, JPEG or WEBP image.');
      }
      if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
        throw new Error(`That image is over ${MAX_AVATAR_MB} MB.`);
      }
      const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${me.id}/avatar.${ext}`;

      const upload = await db.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upload.error) throw upload.error;

      const { data: urlData } = db.storage.from('avatars').getPublicUrl(path);
      updates.avatar_url = `${urlData.publicUrl}?t=${Date.now()}`;
    }

    const { error } = await db.from('profiles').update(updates).eq('id', me.id);
    if (error) throw error;

    $('#profile-dialog').close();
    setMsg(msg, '');
    await loadProfileHeader(me.id);
  } catch (err) {
    setMsg(msg, err.message || 'Something went wrong.');
  }
  button.disabled = false;
});

/* ---------- 7. LOADING THE FEED ---------- */
async function loadFeed() {
  const feed = $('#feed');
  updateHeading();

  if (view.type === 'user') {
    await loadProfileHeader(view.userId);
  } else {
    $('#profile-header').hidden = true;
  }

  feed.innerHTML = '<p class="note">Loading…</p>';

  // THE IMPORTANT BIT: "!posts_user_id_fkey" tells Supabase exactly
  // which connection between posts and profiles to use.
  const postSelect = '*, profiles!posts_user_id_fkey(username, avatar_url)';
  let posts = [];

  if (view.type === 'saved') {
    if (!me) { view = { type: 'latest' }; return loadFeed(); }
    const { data: rows, error } = await db
      .from('saves')
      .select(`created_at, posts(${postSelect})`)
      .eq('user_id', me.id)
      .order('created_at', { ascending: false });
    if (error) return showFeedError(error);
    posts = rows.map((r) => r.posts).filter((p) => p && (!p.is_hidden || p.user_id === me.id));
  } else if (view.type === 'user') {
    const { data: rows, error } = await db
      .from('posts')
      .select(postSelect)
      .eq('user_id', view.userId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return showFeedError(error);
    posts = rows;
  } else {
    const { data: rows, error } = await db
      .from('posts')
      .select(postSelect)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return showFeedError(error);
    posts = rows;
  }

  data = { posts, scores: {}, myVotes: {}, mySaves: new Set(), commentCounts: {} };

  if (posts.length === 0) {
    const empty = view.type === 'saved' ? 'Nothing saved yet.' : 'Nothing here yet. Be the first to share something! 🌱';
    feed.innerHTML = `<p class="note">${empty}</p>`;
    return;
  }

  const ids = posts.map((p) => p.id);
  const [scores, comments, votes, saves] = await Promise.all([
    db.from('post_scores').select('post_id, score').in('post_id', ids),
    db.from('comments').select('post_id').in('post_id', ids),
    me ? db.from('votes').select('post_id, value').eq('user_id', me.id).in('post_id', ids) : { data: [] },
    me ? db.from('saves').select('post_id').eq('user_id', me.id).in('post_id', ids) : { data: [] },
  ]);

  (scores.data || []).forEach((r) => { data.scores[r.post_id] = r.score; });
  (comments.data || []).forEach((r) => { data.commentCounts[r.post_id] = (data.commentCounts[r.post_id] || 0) + 1; });
  (votes.data || []).forEach((r) => { data.myVotes[r.post_id] = r.value; });
  (saves.data || []).forEach((r) => data.mySaves.add(r.post_id));

  feed.innerHTML = posts.map(postHtml).join('');
}

function showFeedError(error) {
  $('#feed').innerHTML = `<p class="note">Couldn't load posts: ${esc(error.message)}<br>Check your URL and key at the top of script.js.</p>`;
}

/* ---------- 8. DRAWING A POST ---------- */
function actionsHtml(p) {
  const vote = data.myVotes[p.id] || 0;
  const saved = data.mySaves.has(p.id);
  const own = me && me.id === p.user_id;
  const commentCount = data.commentCounts[p.id] || 0;

  return `
    <button class="act ${vote === 1 ? 'on' : ''}" data-action="up" title="Upvote">🢁</button>
    <span class="score">${data.scores[p.id] || 0}</span>
    <button class="act ${vote === -1 ? 'on' : ''}" data-action="down" title="Downvote">🢃</button>
    <button class="act ${saved ? 'on' : ''}" data-action="save" title="Save">💾</button>
    <button class="act" data-action="toggle-comments" title="Comments">💬 ${commentCount}</button>
    <span class="spacer"></span>
    ${own ? `
      <button class="link-btn" data-action="pin">${p.is_pinned ? '📌' : '📌'}</button>
      <button class="link-btn" data-action="hide">${p.is_hidden ? '📁' : '📁'}</button>
      <button class="link-btn danger" data-action="delete-post">🗑️</button>
    ` : `
      <button class="link-btn" data-action="report-post">Report</button>
    `}`;
}

function postHtml(p) {
  const name = p.profiles?.username || 'unknown';
  let media = '';
  if (p.media_url && (p.media_type === 'image' || p.media_type === 'gif')) {
    media = `<img class="post-media" src="${esc(p.media_url)}" alt="${esc(p.title)}" loading="lazy">`;
  } else if (p.media_url && p.media_type === 'video') {
    media = `<video class="post-media" src="${esc(p.media_url)}" controls preload="metadata"></video>`;
  }

  return `
    <article class="post" data-id="${p.id}" data-owner="${p.user_id}">
      <div class="post-head">
        ${avatarHtml(p.profiles)}
        <div class="who">
          <button class="username-link" data-action="go-user" data-user-id="${p.user_id}" data-username="${esc(name)}">${esc(name)}</button>
          <span class="time">${formatDate(p.created_at)}</span>
        </div>
        ${p.is_pinned ? '<span class="badge">📌 Pinned</span>' : ''}
        ${p.is_hidden ? '<span class="badge">Hidden (only you see this)</span>' : ''}
      </div>
      <h2 class="post-title">${esc(p.title)}</h2>
      ${p.body ? `<p class="post-text">${esc(p.body)}</p>` : ''}
      ${media}
      <div class="actions">${actionsHtml(p)}</div>
      <div class="comments" hidden>
        <div class="comment-list"></div>
        <div class="new-comment">
          <textarea rows="2" maxlength="2000" placeholder="Write a comment…"></textarea>
          <button class="btn small" data-action="send-comment">Comment</button>
        </div>
      </div>
    </article>`;
}

function refreshActions(postId) {
  const card = document.querySelector(`.post[data-id="${postId}"]`);
  const post = data.posts.find((p) => p.id === postId);
  if (card && post) card.querySelector('.actions').innerHTML = actionsHtml(post);
}

/* ---------- 9. VOTES & SAVES ---------- */
async function vote(postId, value) {
  if (!requireLogin()) return;
  const current = data.myVotes[postId] || 0;
  let error;

  if (current === value) {
    ({ error } = await db.from('votes').delete().eq('post_id', postId).eq('user_id', me.id));
    if (!error) { data.scores[postId] = (data.scores[postId] || 0) - value; data.myVotes[postId] = 0; }
  } else {
    ({ error } = await db.from('votes').upsert({ post_id: postId, user_id: me.id, value }, { onConflict: 'post_id,user_id' }));
    if (!error) { data.scores[postId] = (data.scores[postId] || 0) + value - current; data.myVotes[postId] = value; }
  }
  if (error) return alert('Could not save your vote: ' + error.message);
  refreshActions(postId);
}

async function toggleSave(postId) {
  if (!requireLogin()) return;
  let error;
  if (data.mySaves.has(postId)) {
    ({ error } = await db.from('saves').delete().eq('post_id', postId).eq('user_id', me.id));
    if (!error) data.mySaves.delete(postId);
  } else {
    ({ error } = await db.from('saves').insert({ post_id: postId, user_id: me.id }));
    if (!error) data.mySaves.add(postId);
  }
  if (error) return alert('Could not save: ' + error.message);
  refreshActions(postId);
}

/* ---------- 10. OWN-POST ACTIONS ---------- */
async function togglePin(postId) {
  const post = data.posts.find((p) => p.id === postId);
  const { error } = await db.from('posts').update({ is_pinned: !post.is_pinned }).eq('id', postId);
  if (error) return alert(error.message);
  await loadFeed();
}

async function toggleHide(postId) {
  const post = data.posts.find((p) => p.id === postId);
  const hiding = !post.is_hidden;
  const { error } = await db.from('posts').update({ is_hidden: hiding }).eq('id', postId);
  if (error) return alert(error.message);
  await loadFeed();
  if (hiding && view.type === 'latest') {
    alert('Post hidden. You can find it (and unhide it) by clicking your username at the top.');
  }
}

async function deletePost(postId) {
  if (!confirm('Delete this post forever?')) return;
  const post = data.posts.find((p) => p.id === postId);
  const { error } = await db.from('posts').delete().eq('id', postId);
  if (error) return alert(error.message);
  if (post.media_path) await db.storage.from('media').remove([post.media_path]);
  await loadFeed();
}

/* ---------- 11. COMMENTS ---------- */
async function loadComments(postId, card) {
  const list = card.querySelector('.comment-list');
  const { data: rows, error } = await db
    .from('comments')
    .select('*, profiles!comments_user_id_fkey(username, avatar_url)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) { list.innerHTML = `<p class="note">${esc(error.message)}</p>`; return; }

  data.commentCounts[postId] = rows.length;
  refreshActions(postId);

  if (rows.length === 0) { list.innerHTML = '<p class="small-note">No comments yet.</p>'; return; }

  const byParent = {};
  rows.forEach((c) => {
    const key = c.parent_id || 0;
    (byParent[key] = byParent[key] || []).push(c);
  });

  const ownerId = card.dataset.owner;
  list.innerHTML = (byParent[0] || []).map((c) => commentHtml(c, byParent, ownerId)).join('');
}

function commentHtml(c, byParent, postOwnerId) {
  const own = me && me.id === c.user_id;
  const iAmPostOwner = me && me.id === postOwnerId;
  const replies = (byParent[c.id] || []).map((r) => commentHtml(r, byParent, postOwnerId)).join('');

  return `
    <div class="comment" data-cid="${c.id}">
      <div class="comment-head">
        ${avatarHtml(c.profiles, 'small')}
        <strong>${esc(c.profiles?.username || 'unknown')}</strong>
        <span class="time">${formatDate(c.created_at)}</span>
        ${c.is_starred ? '<span class="starred">⭐ liked by the creator</span>' : ''}
      </div>
      <p class="comment-body">${esc(c.body)}</p>
      <div class="comment-actions">
        <button class="link-btn" data-action="reply">Reply</button>
        ${iAmPostOwner ? `<button class="link-btn" data-action="star">${c.is_starred ? 'Unstar' : '⭐ Star'}</button>` : ''}
        ${own
          ? '<button class="link-btn danger" data-action="delete-comment">Delete</button>'
          : '<button class="link-btn" data-action="report-comment">Report</button>'}
      </div>
      <div class="reply-box" hidden>
        <textarea rows="2" maxlength="2000" placeholder="Write a reply…"></textarea>
        <button class="btn small" data-action="send-reply">Reply</button>
      </div>
      <div class="replies">${replies}</div>
    </div>`;
}

async function addComment(postId, card, textarea, parentId) {
  if (!requireLogin()) return;
  const body = textarea.value.trim();
  if (!body) return;
  const { error } = await db.from('comments').insert({ post_id: postId, user_id: me.id, parent_id: parentId, body });
  if (error) return alert('Could not post comment: ' + error.message);
  textarea.value = '';
  await loadComments(postId, card);
}

/* ---------- 12. REPORTS ---------- */
function startReport(type, id) {
  if (!requireLogin()) return;
  reportTarget = { type, id };
  $('#report-reason').value = '';
  setMsg($('#report-msg'), '');
  openDialog('report-dialog');
}

$('#report-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = $('#report-reason').value.trim();
  if (!reason || !reportTarget) return;
  const row = { reporter_id: me.id, reason };
  if (reportTarget.type === 'post') row.post_id = reportTarget.id;
  else row.comment_id = reportTarget.id;

  const { error } = await db.from('reports').insert(row);
  if (error) return setMsg($('#report-msg'), error.message);
  $('#report-dialog').close();
  alert('Thank you. A moderator will take a look.');
});

/* ---------- 13. SIGN UP / LOG IN / LOG OUT ---------- */
$('#signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#signup-msg');
  setMsg(msg, 'Creating your account…', true);

  const { data: result, error } = await db.auth.signUp({
    email: $('#signup-email').value.trim(),
    password: $('#signup-password').value,
    options: { data: { username: $('#signup-username').value.trim() } },
  });

  if (error) {
    const friendly = error.message.includes('Database error')
      ? 'That username is probably taken. Try another one.'
      : error.message;
    return setMsg(msg, friendly);
  }

  if (!result.session) {
    return setMsg(msg, 'Account created! Check your email to confirm it, then log in.', true);
  }
  $('#signup-form').reset();
  setMsg(msg, '');
  $('#signup-dialog').close();
  await setUser(result.user);
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#login-msg');
  setMsg(msg, 'Logging in…', true);
  const { data: result, error } = await db.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-password').value,
  });
  if (error) return setMsg(msg, error.message);
  $('#login-form').reset();
  setMsg(msg, '');
  $('#login-dialog').close();
  await setUser(result.user);
});

async function logout() {
  await db.auth.signOut();
  view = { type: 'latest' };
  await setUser(null);
}

/* ---------- 14. SHARING A NEW POST ---------- */
$('#upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!me) return;

  const msg = $('#upload-msg');
  const button = e.target.querySelector('button[type="submit"]');
  const title = $('#post-title').value.trim();
  const body = $('#post-body').value.trim();
  const file = $('#post-file').files[0];

  if (!title) return setMsg(msg, 'Please add a title.');
  if (!body && !file) return setMsg(msg, 'Add some text or a file first.');

  let media_url = null, media_path = null, media_type = null;
  button.disabled = true;
  setMsg(msg, 'Sharing… (big files can take a moment)', true);

  try {
    if (file) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`That file is over ${MAX_FILE_MB} MB.`);
      if (file.type === 'image/gif') media_type = 'gif';
      else if (file.type.startsWith('image/')) media_type = 'image';
      else if (file.type.startsWith('video/')) media_type = 'video';
      else throw new Error('Only images, GIFs and videos are supported for now.');

      const ext = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
      media_path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const upload = await db.storage.from('media').upload(media_path, file, { contentType: file.type });
      if (upload.error) throw upload.error;
      media_url = db.storage.from('media').getPublicUrl(media_path).data.publicUrl;
    }

    const { error } = await db.from('posts').insert({ user_id: me.id, title, body, media_url, media_path, media_type });
    if (error) {
      if (media_path) await db.storage.from('media').remove([media_path]);
      throw error;
    }

    $('#upload-form').reset();
    setMsg(msg, '');
    $('#upload-dialog').close();
    view = { type: 'latest' };
    await loadFeed();
  } catch (err) {
    setMsg(msg, err.message || 'Something went wrong.');
  }
  button.disabled = false;
});

/* ---------- 15. ALL BUTTON CLICKS ---------- */
document.addEventListener('click', async (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) { closer.closest('dialog').close(); return; }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const card = btn.closest('.post');
  const postId = card ? Number(card.dataset.id) : null;
  const commentEl = btn.closest('.comment');
  const commentId = commentEl ? Number(commentEl.dataset.cid) : null;

  switch (action) {
    case 'open-login':  openDialog('login-dialog'); break;
    case 'open-signup': openDialog('signup-dialog'); break;
    case 'open-rules':  openDialog('rules-dialog'); break;
    case 'open-upload': openDialog('upload-dialog'); break;
    case 'logout':      await logout(); break;
    case 'go-latest':   view = { type: 'latest' }; await loadFeed(); break;
    case 'go-saved':    view = { type: 'saved' }; await loadFeed(); break;
    case 'my-profile':  view = { type: 'user', userId: me.id, username: me.username }; await loadFeed(); break;
    case 'go-user':
      view = { type: 'user', userId: btn.dataset.userId, username: btn.dataset.username };
      await loadFeed();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;

    case 'edit-profile': await openEditProfile(); break;
    case 'toggle-follow': {
      const wasFollowing = btn.dataset.following === 'true';
      await toggleFollow(btn.dataset.userId, wasFollowing);
      break;
    }

    case 'up':          await vote(postId, 1); break;
    case 'down':        await vote(postId, -1); break;
    case 'save':        await toggleSave(postId); break;
    case 'pin':         await togglePin(postId); break;
    case 'hide':        await toggleHide(postId); break;
    case 'delete-post': await deletePost(postId); break;
    case 'report-post': startReport('post', postId); break;

    case 'toggle-comments': {
      const box = card.querySelector('.comments');
      box.hidden = !box.hidden;
      if (!box.hidden) await loadComments(postId, card);
      break;
    }
    case 'send-comment':
      await addComment(postId, card, btn.closest('.new-comment').querySelector('textarea'), null);
      break;
    case 'reply': {
      const box = commentEl.querySelector('.reply-box');
      box.hidden = !box.hidden;
      break;
    }
    case 'send-reply':
      await addComment(postId, card, btn.closest('.reply-box').querySelector('textarea'), commentId);
      break;
    case 'star': {
      const { error } = await db.rpc('toggle_star', { p_comment_id: commentId });
      if (error) alert(error.message);
      await loadComments(postId, card);
      break;
    }
    case 'delete-comment': {
      if (!confirm('Delete this comment?')) break;
      const { error } = await db.from('comments').delete().eq('id', commentId);
      if (error) alert(error.message);
      await loadComments(postId, card);
      break;
    }
    case 'report-comment': startReport('comment', commentId); break;
  }
});

/* ---------- 16. START THE APP ---------- */
async function start() {
  const { data: { session } } = await db.auth.getSession();
  await setUser(session ? session.user : null);
}
start();