// M-PESA charge calculator (home strip and tools page) and fuel cost helper. Runs on the reader's phone.
(function () {
  var T = window.TNP_TARIFF || [];
  var fee = function (a, col) { for (var i = 0; i < T.length; i++) if (a >= T[i][0] && a <= T[i][1]) return T[i][col]; return undefined; };
  var k = function (n) { return 'KSh ' + Number(n).toLocaleString('en-KE'); };
  function calc(a) {
    if (!a || a < 1) return null; if (a > 250000) return { err: 'M-PESA allows up to KSh 250,000 per transaction.' };
    var s = fee(a, 2), w = fee(a, 3); return { s: s, w: w };
  }
  document.querySelectorAll('[data-mini-amount]').forEach(function (inp) {
    var out = inp.parentNode.querySelector('[data-mini-out]');
    inp.oninput = function () { var r = calc(Math.round(+inp.value)); out.innerHTML = !r ? '<em>Type an amount</em>' : r.err ? '<em>' + r.err + '</em>' : '<span>Send: <b>' + (r.s ? k(r.s) : 'Free') + '</b></span><span>Withdraw: <b>' + (r.w == null ? 'Not allowed' : k(r.w)) + '</b></span>'; };
  });
  var amt = document.getElementById('amt');
  if (amt) amt.oninput = function () {
    var r = calc(Math.round(+amt.value)), o1 = document.getElementById('o1'), o2 = document.getElementById('o2'), o3 = document.getElementById('o3');
    if (!r || r.err) { o1.textContent = o2.textContent = o3.textContent = r && r.err ? 'Too high' : 'KSh 0'; return; }
    o1.textContent = r.s ? k(r.s) : 'Free'; o2.textContent = r.w == null ? 'Not allowed' : k(r.w); o3.textContent = r.w == null ? k(r.s || 0) : k((r.s || 0) + r.w);
  };
  var lit = document.getElementById('lit'), F = window.TNP_FUEL || {};
  if (lit) lit.oninput = function () { var l = +lit.value; document.getElementById('litout').innerHTML = l > 0 ? 'Petrol: <b>' + k(Math.round(l * F.petrol)) + '</b> &middot; Diesel: <b>' + k(Math.round(l * F.diesel)) + '</b>' : ''; };
})();
