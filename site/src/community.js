// Community accounts, story submission, my stories and Scam Radar. Uses Supabase; every submission waits for editor review.
(function () {
  var C = window.TNP_CONFIG || {}, B = C.base || '';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var COUNTIES = ['Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos', 'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', 'Muranga', 'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri', 'Samburu', 'Siaya', 'Taita Taveta', 'Tana River', 'Tharaka Nithi', 'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot', 'Outside Kenya'];
  var CATS = { money: 'Money and M-Pesa', hustles: 'Hustles and Jobs', scams: 'Scams I beat', tech: 'Tech and apps', howto: 'How to' };
  var live = !!(C.url && C.key && window.supabase);
  var sb = live ? window.supabase.createClient(C.url, C.key) : null;
  var soon = '<div class="note info"><b>Community accounts open very soon.</b> We are putting the final touches on sign up. Meanwhile, read our stories and try the Scam Checker.</div>';

  function needLogin(el, why) { el.innerHTML = '<h2 style="font-family:var(--head);margin:0 0 8px">Join to ' + why + '</h2><p style="color:var(--muted);margin:0 0 16px">It is free and takes one minute. No password needed.</p><a class="btn" href="' + B + '/join/?next=' + encodeURIComponent(location.pathname) + '">Create account or sign in</a>'; }
  async function profile(uid) { var r = await sb.from('profiles').select('display_name,county').eq('id', uid).maybeSingle(); return r.data; }

  // ---------- join
  async function join() {
    var el = $('joiner'); if (!el) return; if (!live) { el.innerHTML = soon; return; }
    var next = new URLSearchParams(location.search).get('next') || (B + '/write/');
    var s = (await sb.auth.getSession()).data.session;
    if (s) {
      var p = await profile(s.user.id);
      if (p && p.display_name) { location.href = next; return; }
      el.innerHTML = '<h2 style="font-family:var(--head);margin:0">Welcome! One last step</h2><p style="color:var(--muted)">Choose the name readers will see on your stories. You can use your real name or a pen name.</p><label>Display name</label><input id="dn" maxlength="40" placeholder="e.g. Mwende from Machakos"><label>County</label><select id="co"><option value="">Choose (optional)</option>' + COUNTIES.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select><label style="display:flex;gap:10px;align-items:flex-start;font-weight:500"><input type="checkbox" id="ok" style="width:auto;margin-top:5px"> I agree to the <a href="' + B + '/rules/" style="text-decoration:underline">community rules</a> and <a href="' + B + '/privacy/" style="text-decoration:underline">privacy policy</a>.</label><button class="btn" id="save" style="margin-top:16px">Save and continue</button><div id="st"></div>';
      $('save').onclick = async function () {
        var dn = $('dn').value.trim(); if (dn.length < 3) { $('st').innerHTML = '<div class="note err">Please enter a name of at least 3 letters.</div>'; return; }
        if (!$('ok').checked) { $('st').innerHTML = '<div class="note err">Please agree to the rules to continue.</div>'; return; }
        var r = await sb.from('profiles').upsert({ id: s.user.id, display_name: dn, county: $('co').value || null });
        if (r.error) { $('st').innerHTML = '<div class="note err">' + esc(r.error.message) + '</div>'; return; } location.href = next;
      };
      return;
    }
    el.innerHTML = '<h1 style="font-family:var(--head);margin:0 0 6px;font-size:32px">Join Tech na Pesa</h1><p style="color:var(--muted);margin:0 0 6px">Enter your email. We will send you a sign in link. No password to remember.</p><label>Email address</label><input id="em" type="email" autocomplete="email" placeholder="you@example.com"><button class="btn" id="go" style="margin-top:16px;width:100%;justify-content:center">Send my sign in link</button><div id="st"></div><p class="hint">By joining you agree to our <a href="' + B + '/rules/" style="text-decoration:underline">rules</a> and <a href="' + B + '/privacy/" style="text-decoration:underline">privacy policy</a>.</p>';
    $('go').onclick = async function () {
      var em = $('em').value.trim(); if (!/^\S+@\S+\.\S+$/.test(em)) { $('st').innerHTML = '<div class="note err">Please enter a valid email address.</div>'; return; }
      $('go').disabled = true;
      var r = await sb.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + B + '/join/?next=' + encodeURIComponent(next) } });
      $('go').disabled = false;
      $('st').innerHTML = r.error ? '<div class="note err">' + esc(r.error.message) + '</div>' : '<div class="note ok">Check your email inbox, and the spam folder, for a link from Tech na Pesa. Tap it on this phone to finish.</div>';
    };
  }

  // ---------- write
  async function writer() {
    var el = $('writer'); if (!el) return; if (!live) { el.innerHTML = soon; return; }
    var s = (await sb.auth.getSession()).data.session; if (!s) return needLogin(el, 'share your story');
    var p = await profile(s.user.id); if (!p || !p.display_name) { location.href = B + '/join/?next=' + encodeURIComponent(location.pathname); return; }
    el.innerHTML = '<div class="byline" style="margin-bottom:6px"><span class="avatar">' + esc(p.display_name.slice(0, 1).toUpperCase()) + '</span><span>Writing as <b>' + esc(p.display_name) + '</b> &middot; <a href="' + B + '/me/" style="text-decoration:underline">My stories</a></span></div>'
      + '<label>Headline</label><input id="ti" maxlength="110" placeholder="e.g. How I turned KSh 3,000 into a weekend smokie business">'
      + '<label>Section</label><select id="ca">' + Object.keys(CATS).map(function (k) { return '<option value="' + k + '">' + CATS[k] + '</option>'; }).join('') + '</select>'
      + '<label>Your story</label><textarea id="bo" style="min-height:260px" placeholder="Tell it in your own words. What happened, what you learned, and what others should know."></textarea><div class="hint" id="wc">0 words. Aim for 150 to 800.</div>'
      + '<label>Photo (optional)</label><input id="ph" type="file" accept="image/jpeg,image/png,image/webp"><div class="hint">Your own photo only. No faces of children, no screenshots showing phone numbers. Up to 4 MB.</div>'
      + '<button class="btn" id="send" style="margin-top:18px">Send for review</button><div id="st"></div>';
    $('bo').oninput = function () { var n = ($('bo').value.trim().match(/\S+/g) || []).length; $('wc').textContent = n + ' words. Aim for 150 to 800.'; };
    $('send').onclick = async function () {
      var ti = $('ti').value.trim(), bo = $('bo').value.trim(), n = (bo.match(/\S+/g) || []).length, f = $('ph').files[0];
      if (ti.length < 10) return $('st').innerHTML = '<div class="note err">Please write a headline of at least 10 characters.</div>';
      if (n < 80) return $('st').innerHTML = '<div class="note err">Your story needs at least 80 words. It has ' + n + '.</div>';
      if (f && f.size > 4 * 1024 * 1024) return $('st').innerHTML = '<div class="note err">That photo is too large. Please use one under 4 MB.</div>';
      $('send').disabled = true; $('st').innerHTML = '<div class="note info">Sending...</div>';
      var image = null;
      if (f) { var name = s.user.id + '/' + Date.now() + '.' + (f.type.split('/')[1] || 'jpg'); var up = await sb.storage.from('story-images').upload(name, f, { contentType: f.type }); if (up.error) { $('send').disabled = false; return $('st').innerHTML = '<div class="note err">Photo upload failed: ' + esc(up.error.message) + '</div>'; } image = name; }
      var r = await sb.from('stories').insert({ author: s.user.id, title: ti, body: bo, category: $('ca').value, county: p.county, image_path: image });
      $('send').disabled = false;
      if (r.error) return $('st').innerHTML = '<div class="note err">' + esc(r.error.message) + '</div>';
      el.innerHTML = '<div class="note ok"><b>Thank you! Your story is with our editors.</b> Most stories are reviewed within a few hours. Once it is live you will find it, with a WhatsApp share button, on your <a href="' + B + '/me/" style="text-decoration:underline">My stories</a> page.</div><a class="btn" href="' + B + '/write/">Write another</a>';
    };
  }

  // ---------- my stories
  async function mine() {
    var el = $('mine'); if (!el) return; if (!live) { el.innerHTML = soon; return; }
    var s = (await sb.auth.getSession()).data.session; if (!s) { el.innerHTML = '<div class="panel" id="lg"></div>'; return needLogin($('lg'), 'see your stories'); }
    var r = await sb.from('stories').select('id,title,status,reason,slug,created_at').eq('author', s.user.id).order('created_at', { ascending: false });
    var label = { pending: ['In review', 'info'], approved: ['Live', 'ok'], rejected: ['Not published', 'err'] };
    el.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px"><a class="btn" href="' + B + '/write/">Write a new story</a><button class="btn ghost" style="color:var(--ink)" id="out">Sign out</button></div>'
      + ((r.data || []).length ? (r.data || []).map(function (x) {
        var l = label[x.status] || ['', 'info'], url = x.slug ? location.origin + B + '/community/' + x.slug + '/' : '';
        return '<div class="panel" style="margin-bottom:14px"><span class="note ' + l[1] + '" style="display:inline-block;padding:4px 12px;margin:0 0 8px">' + l[0] + '</span><h3 style="font-family:var(--head);margin:0 0 6px">' + esc(x.title) + '</h3>'
          + (x.status === 'rejected' && x.reason ? '<p class="hint">Editor note: ' + esc(x.reason) + '</p>' : '')
          + (x.status === 'approved' && url ? '<div class="share"><a class="wa" href="https://wa.me/?text=' + encodeURIComponent(x.title + ' ' + url) + '">Share on WhatsApp</a><a href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url) + '">Facebook</a><a href="' + url + '">Open</a></div>' : '')
          + '<button class="btn ghost" style="color:var(--red);padding:7px 14px;font-size:14px" data-del="' + x.id + '">' + (x.status === 'approved' ? 'Ask to remove' : 'Delete') + '</button></div>';
      }).join('') : '<div class="empty">You have not shared a story yet.</div>');
    $('out').onclick = async function () { await sb.auth.signOut(); location.href = B + '/'; };
    el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = async function () { if (!confirm('Remove this story? This cannot be undone.')) return; var d = await sb.from('stories').update({ status: 'removal_requested' }).eq('id', b.dataset.del); if (d.error) alert(d.error.message); else mine(); }; });
  }

  // ---------- Scam Radar
  async function radar() {
    var el = $('radar'); if (!el) return;
    if (!live) { el.innerHTML = '<div class="empty" style="grid-column:1/-1">Scam Radar opens with the community. Until then, use the checker above to protect yourself.</div>'; return; }
    var r = await sb.from('scam_reports').select('kind,public_text,created_at').eq('status', 'approved').order('created_at', { ascending: false }).limit(12);
    el.innerHTML = (r.data || []).length ? r.data.map(function (x) { return '<div class="rcard"><div class="kind">' + esc(x.kind || 'Reported scam') + '</div><p>' + esc(x.public_text) + '</p><div class="meta" style="margin-top:8px">' + new Date(x.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</div></div>'; }).join('') : '<div class="empty" style="grid-column:1/-1">No reports yet. Be the first to warn others.</div>';
  }
  window.TNP_reportScam = async function (last) {
    var st = $('rstatus'); if (!last) return;
    if (!live) { st.innerHTML = '<div class="note info">Scam Radar reporting opens with community accounts, very soon.</div>'; return; }
    var s = (await sb.auth.getSession()).data.session;
    if (!s) { st.innerHTML = '<div class="note info">Please <a href="' + B + '/join/?next=' + encodeURIComponent(B + '/scam-checker/') + '" style="text-decoration:underline">sign in</a> to report, so we can keep Scam Radar free of spam.</div>'; return; }
    var r = await sb.from('scam_reports').insert({ reporter: s.user.id, message: last.text.slice(0, 2000), signals: last.kinds });
    st.innerHTML = r.error ? '<div class="note err">' + esc(r.error.message) + '</div>' : '<div class="note ok">Thank you. Our editors will check it, hide any phone numbers and names, and add it to Scam Radar.</div>';
  };

  join(); writer(); mine(); radar();
})();
