(function () {
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');
  var clockEl = document.getElementById('clock');
  var cfg = { maxMb: 20 };
  var me = null;
  // API ঠিকানা: config.js থেকে; placeholder থাকলে একই সার্ভার (Render) ধরে নেয়
  var CFG = window.APP_CONFIG || {};
  var API_BASE = (CFG.API_BASE && CFG.API_BASE.indexOf('YOUR-APP') < 0) ? CFG.API_BASE.replace(/\/$/, '') : '';
  var FRONT = location.origin + location.pathname;
  var uploadChain = Promise.resolve();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function dateStr(ts) { return new Date(ts).toLocaleString('bn-BD'); }
  function kindOfMime(m) {
    m = m || '';
    if (m.indexOf('image/') === 0) return 'image';
    if (m.indexOf('video/') === 0) return 'video';
    if (m.indexOf('audio/') === 0) return 'audio';
    if (m === 'application/pdf') return 'pdf';
    return 'file';
  }
  function icon(kind) { return { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕' }[kind] || '📄'; }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    var tk = localStorage.getItem('fh_token');
    if (tk) init.headers['Authorization'] = 'Bearer ' + tk;
    return fetch(API_BASE + '/api' + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'সমস্যা হয়েছে'); e.data = d; throw e; }
        return d;
      });
    });
  }

  // ---- header ----
  function setNav() {
    nav.innerHTML = me
      ? '<a href="#/files">আমার ফাইল</a><a href="#/upload">আপলোড</a>' +
        (me.role === 'admin' ? '<a href="#/admin">অ্যাডমিন</a>' : '') +
        '<button class="link" id="logout">লগআউট</button>'
      : '<a href="#/login">লগইন</a><a href="#/register" class="pill">রেজিস্টার</a>';
    var lo = document.getElementById('logout');
    if (lo) lo.onclick = function () {
      api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () {
        localStorage.removeItem('fh_token');
        me = null; location.hash = '#/login'; route();
      });
    };
  }
  function tickClock() {
    clockEl.textContent = new Date().toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  setInterval(tickClock, 1000); tickClock();

  // ---- form helper ----
  function bindForm(id, submit) {
    var form = document.getElementById(id), err = form.querySelector('.err'), btn = form.querySelector('button');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = {};
      new FormData(form).forEach(function (val, k) { v[k] = String(val).trim(); });
      if (v.password !== undefined) v.password = String(new FormData(form).get('password'));
      btn.disabled = true; err.textContent = '';
      Promise.resolve().then(function () { return submit(v); }).catch(function (x) {
        err.textContent = x.message; btn.disabled = false;
      });
    });
  }

  // ---- routing ----
  function route() {
    return api('/me').then(function (d) { me = d.user; }, function () { me = null; }).then(function () {
      setNav();
      if (location.hash.indexOf('#/f/') === 0) return shareView(decodeURIComponent(location.hash.slice(4)));
      var parts = (location.hash.slice(1) || '/').split('?');
      var r = parts[0] || '/';
      var q = new URLSearchParams(parts[1] || '');
      switch (r) {
        case '/login': return loginView();
        case '/register': return registerView();
        case '/verify': return verifyView(q.get('u') || '');
        case '/upload': return me ? uploadView() : loginView();
        case '/files': return me ? filesView() : loginView();
        case '/admin': return me && me.role === 'admin' ? adminView() : loginView();
        default: location.hash = me ? '#/files' : '#/login';
      }
    });
  }

  // ---- auth views ----
  function loginView() {
    app.innerHTML = '<section class="card"><h2>স্বাগতম 👋</h2><p class="muted">লগইন করে আপনার ফাইল ম্যানেজ করুন</p>' +
      '<form id="f"><label>ইউজারনেম<input name="username" required autocomplete="username"></label>' +
      '<label>পাসওয়ার্ড<input name="password" type="password" required autocomplete="current-password"></label>' +
      '<button class="primary wide">লগইন</button><p class="err"></p></form>' +
      '<p class="muted center">অ্যাকাউন্ট নেই? <a href="#/register">রেজিস্টার করুন</a></p></section>';
    bindForm('f', function (v) {
      return api('/auth/login', { method: 'POST', body: v }).then(function (d) {
        localStorage.setItem('fh_token', d.token);
        location.hash = '#/files';
        return route();
      }, function (x) {
        if (x.data && x.data.needsVerify) { location.hash = '#/verify?u=' + encodeURIComponent(x.data.username); return; }
        throw x;
      });
    });
  }

  function registerView() {
    app.innerHTML = '<section class="card"><h2>রেজিস্ট্রেশন</h2>' +
      '<p class="muted">আগে টেলিগ্রামে আমাদের বটে <b>/start</b> লিখুন, তারপর আপনার আইডি দিন (@userinfobot থেকে নিন)।</p>' +
      '<form id="f"><label>ইউজারনেম<input name="username" required minlength="3" maxlength="24"></label>' +
      '<label>টেলিগ্রাম আইডি (সংখ্যা)<input name="telegram_id" required inputmode="numeric"></label>' +
      '<label>পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)<input name="password" type="password" required minlength="6"></label>' +
      '<button class="primary wide">রেজিস্টার করুন</button><p class="err"></p></form>' +
      '<p class="muted center">আগে থেকেই অ্যাকাউন্ট আছে? <a href="#/login">লগইন</a></p></section>';
    bindForm('f', function (v) {
      return api('/auth/register', { method: 'POST', body: v }).then(function () {
        location.hash = '#/verify?u=' + encodeURIComponent(v.username);
      });
    });
  }

  function verifyView(username) {
    app.innerHTML = '<section class="card"><h2>ভেরিফিকেশন</h2>' +
      '<p class="muted">টেলিগ্রামে পাঠানো ৬ সংখ্যার কোডটি দিন।</p>' +
      '<form id="f"><label>কোড<input name="code" required inputmode="numeric" maxlength="6"></label>' +
      '<button class="primary wide">ভেরিফাই</button><p class="err"></p></form>' +
      '<button class="wide" id="resend" style="margin-top:8px">কোড আবার পাঠান</button></section>';
    document.getElementById('resend').onclick = function () {
      api('/auth/resend', { method: 'POST', body: { username: username } })
        .then(function () { alert('নতুন কোড পাঠানো হয়েছে'); }, function (x) { alert(x.message); });
    };
    bindForm('f', function (v) {
      return api('/auth/verify', { method: 'POST', body: { username: username, code: v.code } }).then(function () {
        alert('ভেরিফাই হয়েছে! এখন লগইন করুন।');
        location.hash = '#/login';
      });
    });
  }

  // ---- upload ----
  function uploadOne(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('files', file, file.name);
      var x = new XMLHttpRequest();
      x.open('POST', API_BASE + '/api/files');
      var tk = localStorage.getItem('fh_token');
      if (tk) x.setRequestHeader('Authorization', 'Bearer ' + tk);
      x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = function () {
        var d = {};
        try { d = JSON.parse(x.responseText); } catch (_) {}
        if (x.status >= 200 && x.status < 300) resolve(d);
        else reject(new Error(d.error || 'আপলোড ব্যর্থ'));
      };
      x.onerror = function () { reject(new Error('নেটওয়ার্ক সমস্যা')); };
      x.send(fd);
    });
  }

  function uploadView() {
    app.innerHTML = '<section><h2>ফাইল আপলোড</h2>' +
      '<p class="muted">ছবি, ভিডিও, অডিও, PDF বা যেকোনো ফাইল · সর্বোচ্চ ' + cfg.maxMb + ' MB</p>' +
      '<label class="drop" id="drop"><input type="file" id="pick" multiple hidden>' +
      '<span class="dicon">⬆️</span><b>ফাইল এখানে ছাড়ুন</b><span class="muted">অথবা ক্লিক করে বাছাই করুন</span></label>' +
      '<ul class="ulist" id="ul"></ul></section>';
    var drop = document.getElementById('drop'), pick = document.getElementById('pick'), ul = document.getElementById('ul');

    function queue(files) {
      Array.prototype.forEach.call(files, function (f) {
        var li = document.createElement('li');
        li.className = 'up';
        li.innerHTML = '<span>' + icon(kindOfMime(f.type)) + '</span><div class="grow"><b>' + esc(f.name) + '</b>' +
          '<div class="bar"><i></i></div><small class="muted">' + fmt(f.size) + ' · <span class="st">অপেক্ষায়</span></small></div>';
        ul.prepend(li);
        if (f.size > cfg.maxMb * 1048576) { li.querySelector('.st').textContent = '❌ ' + cfg.maxMb + ' MB-র বেশি'; return; }
        uploadChain = uploadChain.then(function () {
          return uploadOne(f, function (p) {
            li.querySelector('i').style.width = Math.round(p * 100) + '%';
            li.querySelector('.st').textContent = 'আপলোড ' + Math.round(p * 100) + '%';
          }).then(function () {
            li.querySelector('i').style.width = '100%';
            li.querySelector('.st').textContent = '✅ সম্পন্ন';
            li.classList.add('done');
          }, function (e) { li.querySelector('.st').textContent = '❌ ' + e.message; });
        });
      });
    }
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('hot'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('hot'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('hot'); queue(e.dataTransfer.files); });
    pick.addEventListener('change', function () { queue(pick.files); pick.value = ''; });
  }

  // ---- my files ----
  var current = [];

  function previewHtml(f) {
    var src = API_BASE + '/api/share/' + encodeURIComponent(f.share_code) + '/raw';
    if (f.kind === 'image') return '<img src="' + src + '" alt="">';
    if (f.kind === 'video') return '<video src="' + src + '" controls playsinline preload="metadata"></video>';
    if (f.kind === 'audio') return '<audio src="' + src + '" controls></audio>';
    if (f.kind === 'pdf') return '<iframe src="' + src + '"></iframe>';
    return '<div class="nopreview">📄 এই ধরনের ফাইলের প্রিভিউ নেই — ডাউনলোড করুন</div>';
  }
  function openModal(f) {
    var m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="mbox"><div class="row"><b>' + esc(f.name) + '</b><button data-x>বন্ধ করুন</button></div>' +
      '<div class="mprev">' + previewHtml(f) + '</div>' +
      '<div class="row"><a class="btn primary" href="' + API_BASE + '/api/share/' + f.share_code + '/raw?download=1">⬇️ ডাউনলোড</a>' +
      '<span class="muted">' + fmt(f.size) + '</span></div></div>';
    m.addEventListener('click', function (e) { if (e.target === m || e.target.hasAttribute('data-x')) m.remove(); });
    document.body.appendChild(m);
  }

  function filesView() {
    app.innerHTML = '<section><div class="row"><h2>আমার ফাইল</h2><a class="btn primary" href="#/upload">+ আপলোড</a></div>' +
      '<input class="search" id="search" placeholder="ফাইল খুঁজুন…"><div class="grid" id="grid"></div></section>';
    var grid = document.getElementById('grid'), timer = null;

    function load(q) {
      api('/files?q=' + encodeURIComponent(q || '')).then(function (d) {
        current = d.files;
        grid.innerHTML = current.length ? current.map(function (f, i) {
          return '<div class="fcard"><div class="fic">' + icon(f.kind) + '</div><div>' +
            '<b>' + esc(f.name) + '</b><div class="muted">' + fmt(f.size) + ' · ⬇️ ' + f.downloads + '</div>' +
            '<div class="muted">' + dateStr(f.created_at) + '</div></div>' +
            '<div class="acts" data-i="' + i + '">' +
            '<button data-act="preview">প্রিভিউ</button><button data-act="copy">লিংক কপি</button>' +
            '<button data-act="rename">নাম বদল</button><button class="danger" data-act="del">মুছুন</button></div></div>';
        }).join('') : '<p class="muted">কোনো ফাইল নেই। <a href="#/upload">আপলোড করুন</a></p>';
      }, function (x) { grid.innerHTML = '<p class="err">' + esc(x.message) + '</p>'; });
    }

    document.getElementById('search').addEventListener('input', function (e) {
      clearTimeout(timer);
      var v = e.target.value;
      timer = setTimeout(function () { load(v); }, 250);
    });
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var f = current[Number(b.parentNode.dataset.i)];
      var act = b.dataset.act;
      if (act === 'preview') openModal(f);
      if (act === 'copy') {
        var link = FRONT + '#/f/' + f.share_code;
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { alert('লিংক কপি হয়েছে:\n' + link); });
        else prompt('লিংক কপি করুন:', link);
      }
      if (act === 'rename') {
        var name = prompt('নতুন নাম:', f.name);
        if (name) api('/files/' + f.id, { method: 'PATCH', body: { name: name } }).then(function () { load(); }, function (x) { alert(x.message); });
      }
      if (act === 'del') {
        if (confirm('ফাইলটি মুছে ফেলবেন? শেয়ার লিংক আর কাজ করবে না।')) {
          api('/files/' + f.id, { method: 'DELETE' }).then(function () { load(); }, function (x) { alert(x.message); });
        }
      }
    });
    load('');
  }

  // ---- public share page ----
  function shareView(code) {
    app.innerHTML = '<section class="share"><p class="muted">লোড হচ্ছে…</p></section>';
    api('/share/' + encodeURIComponent(code)).then(function (d) {
      var f = d.file;
      app.innerHTML = '<section class="share"><div class="mbox" style="max-height:none">' +
        '<div class="row"><div><h2>' + esc(f.name) + '</h2><div class="muted">' + fmt(f.size) + ' · ⬇️ ' + f.downloads +
        ' · শেয়ার করেছেন: ' + esc(f.owner) + '</div></div>' +
        '<a class="btn primary" href="' + API_BASE + '/api/share/' + f.share_code + '/raw?download=1">⬇️ ডাউনলোড</a></div>' +
        '<div class="mprev" style="min-height:300px">' + previewHtml(f) + '</div></div></section>';
    }, function (x) {
      app.innerHTML = '<section class="card center"><h2>দুঃখিত</h2><p class="muted">' + esc(x.message) + '</p><a href="#/files">হোম</a></section>';
    });
  }

  // ---- admin ----
  var adminTab = 'stats';
  function adminView() {
    app.innerHTML = '<div class="admin"><aside class="side"><div class="sh">⚙️ Admin Panel</div>' +
      '<button class="mi" data-t="stats">📊 ড্যাশবোর্ড</button>' +
      '<button class="mi" data-t="users">👥 ইউজার</button>' +
      '<button class="mi" data-t="files">📁 সব ফাইল</button></aside>' +
      '<section class="amain" id="am"></section></div>';
    var am = document.getElementById('am');

    document.querySelectorAll('.mi').forEach(function (b) {
      b.onclick = function () { adminTab = b.dataset.t; show(); };
    });
    am.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ban !== undefined) {
        api('/admin/users/' + b.dataset.ban + '/ban', { method: 'POST', body: { banned: b.dataset.v === '1' } }).then(show, alert2);
      } else if (b.dataset.udel !== undefined) {
        if (confirm('ইউজার ও তার সব ফাইল মুছে ফেলবেন?')) api('/admin/users/' + b.dataset.udel, { method: 'DELETE' }).then(show, alert2);
      } else if (b.dataset.fdel !== undefined) {
        if (confirm('ফাইলটি মুছবেন?')) api('/files/' + b.dataset.fdel, { method: 'DELETE' }).then(show, alert2);
      }
    });
    function alert2(x) { alert(x.message); }

    function show() {
      document.querySelectorAll('.mi').forEach(function (b) { b.classList.toggle('on', b.dataset.t === adminTab); });
      if (adminTab === 'stats') {
        api('/admin/stats').then(function (d) {
          var s = d.stats;
          am.innerHTML = '<h2>ড্যাশবোর্ড</h2><div class="stats">' +
            [['ইউজার', s.users], ['ফাইল', s.files], ['মোট সাইজ', fmt(s.bytes)], ['মোট ডাউনলোড', s.downloads]]
              .map(function (x) { return '<div class="stat"><small class="muted">' + x[0] + '</small><b>' + x[1] + '</b></div>'; }).join('') +
            '</div>';
        });
      } else if (adminTab === 'users') {
        api('/admin/users').then(function (d) {
          am.innerHTML = '<h2>ইউজার</h2><div class="tbl">' + d.users.map(function (u) {
            var info = esc(u.role) + ' · টেলিগ্রাম: ' + esc(u.telegram_id || '-') + ' · ফাইল: ' + u.files +
              (u.verified ? '' : ' · ⏳ ভেরিফাই হয়নি') + (u.banned ? ' · 🚫 বন্ধ' : '');
            var btns = u.role === 'admin' ? '' :
              '<button data-ban="' + u.id + '" data-v="' + (u.banned ? 0 : 1) + '">' + (u.banned ? 'আনব্লক' : 'ব্লক') + '</button>' +
              '<button class="danger" data-udel="' + u.id + '">মুছুন</button>';
            return '<div class="trow"><div><b>' + esc(u.username) + '</b><span class="muted">' + info + '</span></div><div class="acts">' + btns + '</div></div>';
          }).join('') + '</div>';
        }, alert2);
      } else {
        api('/admin/files').then(function (d) {
          am.innerHTML = '<h2>সব ফাইল</h2><div class="tbl">' + d.files.map(function (f) {
            return '<div class="trow"><div><b>' + esc(f.name) + '</b><span class="muted">' + esc(f.owner) + ' · ' + fmt(f.size) +
              ' · ⬇️ ' + f.downloads + '</span></div><div class="acts"><a class="btn" href="' + FRONT + '#/f/' + f.share_code + '" target="_blank">দেখুন</a>' +
              '<button class="danger" data-fdel="' + f.id + '">মুছুন</button></div></div>';
          }).join('') + '</div>';
        }, alert2);
      }
    }
    show();
  }

  // ---- boot ----
  api('/config').then(function (c) { cfg = c; }, function () {}).then(function () {
    window.addEventListener('hashchange', route);
    route();
  });
})();
