/* =====================================================
   FreezeFelis — script.js  (V0.6)
   Adds: search, notifications, edit posts/comments,
   mentions, audio, boop, Following tab, forgot password,
   "I'm facing a problem", Top tab
   ===================================================== */

/* ---------- 1. YOUR SETTINGS ---------- */
const SUPABASE_URL = 'https://nyjasgfyfrkpjrrnklkm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cR28i7fxZ0I7P99QA69PVQ_ge-6CHQS';

// 👇👇👇 PASTE YOUR FORMSPREE URL HERE 👇👇👇
const FORMSPREE_URL = 'https://formspree.io/f/PASTE_YOURS_HERE';

// How many days back the "Top" tab looks. Set to 0 for all-time.
const TOP_WINDOW_DAYS = 7;

const MAX_FILE_MB = 100;
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

function linkifyMentions(escapedText) {
  if (!escapedText) return '';
  return escapedText.replace(/@([A-Za-z0-9_]{3,20})/g, (m, name) =>
    `<button type="button" class="mention" data-action="go-username" data-username="${name}">@${name}</button>`
  );
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
  if (me) loadUnreadCount();
  await loadFeed();
}

function updateHeader() {
  const area = $('#auth-area');
  if (me) {
    area.innerHTML = `
      <button class="link-btn" data-action="my-profile">${esc(me.username)}</button>
      <button class="btn" data-action="open-upload">+ Share something</button>
      <div class="notif-wrap">
        <button class="bell-btn" data-action="toggle-notifs" title="Notifications">🔔<span id="notif-badge" class="notif-badge" hidden>0</span></button>
        <div id="notif-dropdown" class="notif-dropdown" hidden></div>
      </div>
      <button class="btn ghost" data-action="logout">Log out</button>`;
  } else {
    area.innerHTML = `
      <button class="btn ghost" data-action="open-login">Log in</button>
      <button class="btn" data-action="open-signup">Join</button>`;
  }
  $('#tab-saved').hidden = !me;
  $('#tab-following').hidden = !me;
}

function updateHeading() {
  $('#tab-latest').classList.toggle('active', view.type === 'latest');
  $('#tab-top').classList.toggle('active', view.type === 'top');
  $('#tab-following').classList.toggle('active', view.type === 'following');
  $('#tab-saved').classList.toggle('active', view.type === 'saved');
  if (view.type === 'latest') {
    $('#view-title').textContent = 'Latest Uploads';
    $('#view-sub').textContent = 'A space made for artists, people who genuinely love art. Whether you draw, paint, animate, sculpt, photograph, write, act, make music, create videos, or express yourself through any other form of art, you’re welcome here.';
  } else if (view.type === 'top') {
    $('#view-title').textContent = 'Top';
    $('#view-sub').textContent = TOP_WINDOW_DAYS > 0
      ? `The most-loved posts from the last ${TOP_WINDOW_DAYS} days.`
      : 'The most-loved posts of all time.';
  } else if (view.type === 'following') {
    $('#view-title').textContent = 'Following';
    $('#view-sub').textContent = 'The newest work from the people you follow.';
  } else if (view.type === 'saved') {
    $('#view-title').textContent = 'Saved';
    $('#view-sub').textContent = 'Things you wanted to keep. Only you can see this.';
  } else if (view.type === 'search') {
    $('#view-title').textContent = `Search: "${view.query}"`;
    $('#view-sub').textContent = '';
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
    actionHtml = `
      <button class="btn ${iFollow ? 'ghost' : ''}" data-action="toggle-follow" data-user-id="${userId}" data-following="${iFollow}">${iFollow ? 'Following ✓' : 'Follow'}</button>
      <button class="btn ghost" data-action="boop" data-user-id="${userId}">👋 Boop</button>`;
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

/* ---------- 6b. EDIT PROFILE ---------- */
async function openEditProfile() {
  const { data: profile } = await db
    .from('profiles')
    .select('username, bio')
    .eq('id', me.id)
    .single();

  $('#profile-username').value = profile?.username || me.username || '';
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
  const newUsername = $('#profile-username').value.trim();
  const bio = $('#profile-bio').value.trim();
  const file = $('#profile-avatar').files[0];

  if (!newUsername) return setMsg(msg, 'Please add a username.');

  button.disabled = true;
  setMsg(msg, 'Saving…', true);

  try {
    const updates = { bio, username: newUsername };

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
    if (error) {
      if (error.code === '23505' || /duplicate/i.test(error.message)) {
        throw new Error('That username is already taken. Try another one.');
      }
      throw error;
    }

    me.username = newUsername;

    $('#profile-dialog').close();
    setMsg(msg, '');
    updateHeader();
    await loadProfileHeader(me.id);
  } catch (err) {
    setMsg(msg, err.message || 'Something went wrong.');
  }
  button.disabled = false;
});

/* ---------- 6c. NOTIFICATIONS ---------- */
async function loadUnreadCount() {
  if (!me) return;
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const { count } = await db
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', me.id)
    .eq('is_read', false);
  if (count && count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

async function loadNotifications() {
  if (!me) return;
  const dropdown = document.getElementById('notif-dropdown');
  if (!dropdown) return;

  const { data: rows, error } = await db
    .from('notifications')
    .select('*')
    .eq('user_id', me.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    dropdown.innerHTML = `<p class="small-note" style="padding:8px">${esc(error.message)}</p>`;
    return;
  }
  if (!rows || rows.length === 0) {
    dropdown.innerHTML = '<p class="small-note" style="padding:8px">No notifications yet.</p>';
    return;
  }

  dropdown.innerHTML = `
    <div class="notif-head">
      <strong>Notifications</strong>
      <button class="link-btn" data-action="mark-all-read">Mark all read</button>
    </div>
    ${rows.map((n) => `
      <button class="notif-item ${n.is_read ? '' : 'unread'}" data-action="open-notif" data-id="${n.id}" ${n.post_id ? `data-post-id="${n.post_id}"` : ''}>
        <span>${esc(n.message)}</span>
        <span class="time">${formatDate(n.created_at)}</span>
      </button>
    `).join('')}`;
}

/* ---------- 6d. FORGOT PASSWORD ---------- */
function openForgotPassword() {
  const typedEmail = $('#login-email').value.trim();
  $('#forgot-email').value = typedEmail;
  setMsg($('#forgot-msg'), '');
  openDialog('forgot-dialog');
}

$('#forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#forgot-msg');
  const button = e.target.querySelector('button[type="submit"]');
  const email = $('#forgot-email').value.trim();

  if (!email) return setMsg(msg, 'Please add your email.');

  button.disabled = true;
  setMsg(msg, 'Sending…', true);

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });

  button.disabled = false;
  if (error) return setMsg(msg, error.message);

  setMsg(msg, 'Check your inbox — the link is on its way. (Look in spam if you don\'t see it.)', true);
  $('#forgot-form').reset();
});

db.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    setMsg($('#reset-msg'), '');
    $('#reset-password').value = '';
    $('#reset-confirm').value = '';
    openDialog('reset-dialog');
  }
});

$('#reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#reset-msg');
  const button = e.target.querySelector('button[type="submit"]');
  const pw = $('#reset-password').value;
  const pw2 = $('#reset-confirm').value;

  if (pw.length < 8) return setMsg(msg, 'Password must be at least 8 characters.');
  if (pw !== pw2) return setMsg(msg, 'The two passwords don\'t match.');

  button.disabled = true;
  setMsg(msg, 'Saving…', true);

  const { error } = await db.auth.updateUser({ password: pw });

  button.disabled = false;
  if (error) return setMsg(msg, error.message);

  setMsg(msg, 'Password updated. You\'re all set.', true);
  setTimeout(() => {
    $('#reset-dialog').close();
    $('#reset-form').reset();
  }, 1500);
});

/* ---------- 6e. "I'M FACING A PROBLEM" ---------- */
$('#problem-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#problem-msg');
  const button = e.target.querySelector('button[type="submit"]');
  const type = $('#problem-type').value;
  const details = $('#problem-details').value.trim();
  const email = $('#problem-email').value.trim();

  if (!details) return setMsg(msg, 'Please add some details.');

  if (FORMSPREE_URL.includes('PASTE_YOURS_HERE')) {
    return setMsg(msg, 'The form isn\'t connected yet — the site owner needs to add their Formspree URL in script.js.');
  }

  button.disabled = true;
  setMsg(msg, 'Sending…', true);

  try {
    const res = await fetch(FORMSPREE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: `FreezeFelis problem: ${type}`,
        what_kind: type,
        details,
        reply_email: email || '(not given)',
        page: window.location.href,
        when: new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error('Could not send. Please try again.');
    $('#problem-form').reset();
    setMsg(msg, 'Thank you — sent! 🌱', true);
    setTimeout(() => {
      $('#problem-dialog').close();
      setMsg(msg, '');
    }, 1500);
  } catch (err) {
    setMsg(msg, err.message || 'Something went wrong.');
  }
  button.disabled = false;
});

/* ---------- 7. LOADING THE FEED ---------- */
async function loadFeed() {
  const feed = $('#feed');
  updateHeading();

  if (view.type !== 'search' && view.type !== 'following') {
    $('#search-users').hidden = true;
    $('#search-users').innerHTML = '';
  }

  if (view.type === 'user') {
    await loadProfileHeader(view.userId);
  } else {
    $('#profile-header').hidden = true;
  }

  feed.innerHTML = '<p class="note">Loading…</p>';

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
  } else if (view.type === 'top') {
    // 1) Highest-scoring posts first
    const { data: scoreRows, error: scoreErr } = await db
      .from('post_scores')
      .select('post_id, score')
      .order('score', { ascending: false })
      .limit(200);
    if (scoreErr) return showFeedError(scoreErr);

    const scoreIds = (scoreRows || []).map((r) => r.post_id);
    if (scoreIds.length === 0) {
      posts = [];
    } else {
      // 2) Load those posts (skip hidden ones)
      const { data: rows, error } = await db
        .from('posts')
        .select(postSelect)
        .eq('is_hidden', false)
        .in('id', scoreIds);
      if (error) return showFeedError(error);

      // 3) Put them back into score order
      const order = new Map(scoreIds.map((id, i) => [id, i]));
      let ordered = (rows || []).sort((a, b) => order.get(a.id) - order.get(b.id));

      // 4) Optional time window (skipped if TOP_WINDOW_DAYS is 0)
      if (TOP_WINDOW_DAYS > 0) {
        const cutoff = Date.now() - TOP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        ordered = ordered.filter((p) => new Date(p.created_at).getTime() >= cutoff);
      }

      posts = ordered.slice(0, 50);
    }
  } else if (view.type === 'following') {
    if (!me) { view = { type: 'latest' }; return loadFeed(); }

    const { data: followRows, error: followErr } = await db
      .from('follows')
      .select('following_id')
      .eq('follower_id', me.id);
    if (followErr) return showFeedError(followErr);
    const followIds = (followRows || []).map((r) => r.following_id);

    const userBox = $('#search-users');
    if (followIds.length > 0) {
      const { data: followed } = await db
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', followIds);
      if (followed && followed.length > 0) {
        userBox.hidden = false;
        userBox.innerHTML = followed.map((u) => `
          <button class="search-user-btn" data-action="go-user" data-user-id="${u.id}" data-username="${esc(u.username)}">
            ${avatarHtml(u, 'small')}<span>${esc(u.username)}</span>
          </button>`).join('');
      } else {
        userBox.hidden = true;
        userBox.innerHTML = '';
      }

      const { data: rows, error } = await db
        .from('posts')
        .select(postSelect)
        .eq('is_hidden', false)
        .in('user_id', followIds)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return showFeedError(error);
      posts = rows;
    } else {
      userBox.hidden = true;
      userBox.innerHTML = '';
    }
  } else if (view.type === 'user') {
    const { data: rows, error } = await db
      .from('posts')
      .select(postSelect)
      .eq('user_id', view.userId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return showFeedError(error);
    posts = rows;
  } else if (view.type === 'search') {
    const { data: users } = await db
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${view.query}%`)
      .limit(20);
    const userBox = $('#search-users');
    if (users && users.length > 0) {
      userBox.hidden = false;
      userBox.innerHTML = users.map((u) => `
        <button class="search-user-btn" data-action="go-user" data-user-id="${u.id}" data-username="${esc(u.username)}">
          ${avatarHtml(u, 'small')}<span>${esc(u.username)}</span>
        </button>`).join('');
    }

    const [byTitle, byBody] = await Promise.all([
      db.from('posts').select(postSelect).eq('is_hidden', false).ilike('title', `%${view.query}%`).limit(50),
      db.from('posts').select(postSelect).eq('is_hidden', false).ilike('body', `%${view.query}%`).limit(50),
    ]);
    if (byTitle.error) return showFeedError(byTitle.error);
    if (byBody.error) return showFeedError(byBody.error);
    const seen = new Set();
    posts = [...(byTitle.data || []), ...(byBody.data || [])]
      .filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
    const empty = view.type === 'saved'
      ? 'Nothing saved yet.'
      : view.type === 'top'
        ? 'No loved posts here yet. Give some upvotes and they\'ll show up!'
        : view.type === 'following'
          ? (($('#search-users').hidden)
              ? "You're not following anyone yet. Click any username on a post to see their profile and follow them."
              : "The people you follow haven't posted anything yet — but they're up above whenever you want to check in.")
          : view.type === 'search'
            ? 'No posts match your search.'
            : 'Nothing here yet. Be the first to share something!';
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
      <button class="link-btn" data-action="pin" title="${p.is_pinned ? 'Unpin' : 'Pin'}">📌</button>
      <button class="link-btn" data-action="hide" title="${p.is_hidden ? 'Unhide' : 'Hide'}">📁</button>
      <button class="link-btn" data-action="edit-post" title="Edit">✏️</button>
      <button class="link-btn danger" data-action="delete-post" title="Delete">🗑️</button>
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
  } else if (p.media_url && p.media_type === 'audio') {
    media = `<audio class="post-media audio-media" src="${esc(p.media_url)}" controls preload="metadata"></audio>`;
  }

  return `
    <article class="post" data-id="${p.id}" data-owner="${p.user_id}">
      <div class="post-head">
        ${avatarHtml(p.profiles)}
        <div class="who">
          <button class="username-link" data-action="go-user" data-user-id="${p.user_id}" data-username="${esc(name)}">${esc(name)}</button>
          <span class="time">${formatDate(p.created_at)}</span>
        </div>
        ${p.is_pinned && view.type === 'user' ? '<span class="badge">📌 Pinned</span>' : ''}
        ${p.is_hidden ? '<span class="badge">Hidden (only you see this)</span>' : ''}
      </div>
      <h2 class="post-title">${esc(p.title)}</h2>
      ${p.body ? `<p class="post-text">${linkifyMentions(esc(p.body))}</p>` : ''}
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

/* ---------- 10b. EDIT A POST (inline) ---------- */
function openEditPost(card, postId) {
  if (card.querySelector('.edit-post-form')) return;
  const post = data.posts.find((p) => p.id === postId);
  if (!post) return;

  const titleEl = card.querySelector('.post-title');
  const textEl = card.querySelector('.post-text');

  const form = document.createElement('div');
  form.className = 'edit-post-form';
  form.innerHTML = `
    <input type="text" class="edit-title" value="${esc(post.title)}" maxlength="120">
    <textarea class="edit-body" rows="4" maxlength="5000">${esc(post.body || '')}</textarea>
    <div class="edit-buttons">
      <button class="link-btn" data-action="cancel-edit-post">Cancel</button>
      <button class="btn small" data-action="save-edit-post">Save</button>
    </div>`;
  titleEl.style.display = 'none';
  if (textEl) textEl.style.display = 'none';
  titleEl.after(form);
}

async function saveEditPost(card, postId) {
  const title = card.querySelector('.edit-title').value.trim();
  const body = card.querySelector('.edit-body').value.trim();
  if (!title) return alert('Please add a title.');
  const { error } = await db.from('posts').update({ title, body }).eq('id', postId);
  if (error) return alert(error.message);
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
      <p class="comment-body">${linkifyMentions(esc(c.body))}</p>
      <div class="comment-actions">
        <button class="link-btn" data-action="reply">Reply</button>
        ${iAmPostOwner ? `<button class="link-btn" data-action="star">${c.is_starred ? 'Unstar' : '⭐ Star'}</button>` : ''}
        ${own
          ? `<button class="link-btn" data-action="edit-comment">Edit</button>
             <button class="link-btn danger" data-action="delete-comment">Delete</button>`
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

function openEditComment(commentEl) {
  if (commentEl.querySelector('.edit-comment-form')) return;
  const bodyEl = commentEl.querySelector('.comment-body');
  const currentBody = bodyEl.textContent;

  const form = document.createElement('div');
  form.className = 'edit-comment-form';
  form.innerHTML = `
    <textarea class="edit-comment-body" rows="2" maxlength="2000">${esc(currentBody)}</textarea>
    <div class="edit-buttons">
      <button class="link-btn" data-action="cancel-edit-comment">Cancel</button>
      <button class="btn small" data-action="save-edit-comment">Save</button>
    </div>`;
  bodyEl.style.display = 'none';
  bodyEl.after(form);
}

async function saveEditComment(postId, card, commentEl, commentId) {
  const newBody = commentEl.querySelector('.edit-comment-body').value.trim();
  if (!newBody) return;
  const { error } = await db.from('comments').update({ body: newBody }).eq('id', commentId);
  if (error) return alert(error.message);
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
      else if (file.type.startsWith('audio/')) media_type = 'audio';
      else throw new Error('Only images, GIFs, videos and audio are supported for now.');

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

/* ---------- 15. SEARCH FORM ---------- */
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (!q) {
    view = { type: 'latest' };
    await loadFeed();
    return;
  }
  view = { type: 'search', query: q };
  await loadFeed();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ---------- 16. ALL BUTTON CLICKS ---------- */
document.addEventListener('click', async (e) => {
  const dd = document.getElementById('notif-dropdown');
  if (dd && !dd.hidden && !e.target.closest('.notif-wrap')) dd.hidden = true;

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
    // header & navigation
    case 'open-login':   openDialog('login-dialog'); break;
    case 'open-signup':  openDialog('signup-dialog'); break;
    case 'open-rules':   openDialog('rules-dialog'); break;
    case 'open-upload':  openDialog('upload-dialog'); break;
    case 'open-forgot':  openForgotPassword(); break;
    case 'open-problem': {
      $('#problem-form').reset();
      setMsg($('#problem-msg'), '');
      openDialog('problem-dialog');
      break;
    }
    case 'logout':       await logout(); break;
    case 'go-latest':    view = { type: 'latest' };    $('#search-input').value = ''; await loadFeed(); break;
    case 'go-top':       view = { type: 'top' };       $('#search-input').value = ''; await loadFeed(); break;
    case 'go-following': view = { type: 'following' }; $('#search-input').value = ''; await loadFeed(); break;
    case 'go-saved':     view = { type: 'saved' };     await loadFeed(); break;
    case 'my-profile':   view = { type: 'user', userId: me.id, username: me.username }; await loadFeed(); break;
    case 'go-user':
      view = { type: 'user', userId: btn.dataset.userId, username: btn.dataset.username };
      await loadFeed();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'go-username': {
      const uname = btn.dataset.username;
      const { data: p } = await db.from('profiles').select('id, username').eq('username', uname).maybeSingle();
      if (!p) { alert('@' + uname + ' not found.'); break; }
      view = { type: 'user', userId: p.id, username: p.username };
      await loadFeed();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    }

    // notifications
    case 'toggle-notifs': {
      const dropdown = document.getElementById('notif-dropdown');
      if (!dropdown) break;
      if (dropdown.hidden) {
        await loadNotifications();
        dropdown.hidden = false;
      } else {
        dropdown.hidden = true;
      }
      break;
    }
    case 'mark-all-read': {
      await db.from('notifications').update({ is_read: true }).eq('user_id', me.id).eq('is_read', false);
      await loadNotifications();
      await loadUnreadCount();
      break;
    }
    case 'open-notif': {
      const nid = Number(btn.dataset.id);
      const nPostId = btn.dataset.postId ? Number(btn.dataset.postId) : null;
      await db.from('notifications').update({ is_read: true }).eq('id', nid);
      document.getElementById('notif-dropdown').hidden = true;
      await loadUnreadCount();
      if (nPostId) {
        view = { type: 'latest' };
        await loadFeed();
        setTimeout(() => {
          const target = document.querySelector(`.post[data-id="${nPostId}"]`);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      }
      break;
    }

    // profile page
    case 'edit-profile': await openEditProfile(); break;
    case 'delete-account': {
      const typed = prompt(
        'This will permanently delete your account, along with all your posts, comments, votes, saves, follows and uploaded files.\n\n' +
        'This cannot be undone.\n\n' +
        'Type DELETE in capital letters to confirm:'
      );
      if (typed === null) break;
      if (typed !== 'DELETE') {
        alert('Cancelled. Nothing was deleted.');
        break;
      }
      const { error } = await db.rpc('delete_my_account');
      if (error) {
        alert('Could not delete your account: ' + error.message);
        break;
      }
      alert('Your account has been deleted');
      await db.auth.signOut();
      view = { type: 'latest' };
      await setUser(null);
      break;
    }
    case 'toggle-follow': {
      const wasFollowing = btn.dataset.following === 'true';
      await toggleFollow(btn.dataset.userId, wasFollowing);
      break;
    }
    case 'boop': {
      const targetId = btn.dataset.userId;
      const { error } = await db.rpc('send_boop', { target_user_id: targetId });
      if (error) return alert(error.message);
      const originalText = btn.textContent;
      btn.textContent = 'Booped! ✨';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
      break;
    }

    // post buttons
    case 'up':          await vote(postId, 1); break;
    case 'down':        await vote(postId, -1); break;
    case 'save':        await toggleSave(postId); break;
    case 'pin':         await togglePin(postId); break;
    case 'hide':        await toggleHide(postId); break;
    case 'delete-post': await deletePost(postId); break;
    case 'report-post': startReport('post', postId); break;
    case 'edit-post':   openEditPost(card, postId); break;
    case 'save-edit-post':   await saveEditPost(card, postId); break;
    case 'cancel-edit-post': await loadFeed(); break;

    // comments
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
    case 'edit-comment':   openEditComment(commentEl); break;
    case 'save-edit-comment':   await saveEditComment(postId, card, commentEl, commentId); break;
    case 'cancel-edit-comment': await loadComments(postId, card); break;
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

/* ---------- 17. START THE APP ---------- */
async function start() {
  const { data: { session } } = await db.auth.getSession();
  await setUser(session ? session.user : null);
}
start();