// Scam Checker: runs entirely on the reader's phone. Rules describe the tricks Kenyan fraudsters use most.
(function () {
  var RULES = [
    { w: 5, name: 'Asks for your PIN, password or a code', why: 'No bank, Safaricom or government office will ever ask for your M-PESA PIN, password or a one time code.', re: /\b(m-?pesa\s*pin|pin\s*(number|yako)|your\s*pin|otp|one[\s-]*time\s*(pass(word)?|code)|verification\s*code|password|nambari\s*ya\s*siri|send\s*(me\s*)?the\s*code)\b/gi },
    { w: 4, name: 'Money "sent by mistake"', why: 'A classic trick. Real reversals only come from Safaricom\'s Reversal channel. Check your real M-PESA balance and never send money back to a caller.', re: /\b(by\s*mistake|wrong(ly)?\s*(number|sent)|kimakosa|nimekosea|reverse|reversal|rudisha|nirudishie)\b/gi },
    { w: 4, name: 'You must pay a fee first', why: 'Genuine jobs, loans and prizes do not ask you to pay before you receive them.', re: /\b(processing|registration|application|interview|medical|clearance|activation|service|facilitation|commitment|booking|insurance)\s*fee|\bpay\s*(a\s*)?fee\b|\bfee\s*of\s*(ksh|kes|sh)/gi },
    { w: 3, name: 'A prize or windfall you did not enter for', why: 'If you did not enter a promotion, you did not win it.', re: /\b(you\s*(have\s*)?won|winner|umeshinda|congratulations|jackpot|bonus\s*of|selected\s*to\s*receive|promotion\s*winner|reward\s*of)\b/gi },
    { w: 3, name: 'Pressure to act fast', why: 'Scammers rush you so you do not stop to check.', re: /\b(urgent(ly)?|immediately|within\s*\d+\s*(min(ute)?s?|hours?|hrs?)|today\s*only|last\s*chance|haraka|sasa\s*hivi|expires?\s*(today|soon)|act\s*now)\b/gi },
    { w: 3, name: 'Too good to be true returns', why: 'Promises to double money or guaranteed profits are the mark of pyramid and fake investment schemes.', re: /\b(double\s*your|guaranteed\s*(returns?|profit)|\d{2,3}\s*%\s*(daily|weekly|profit|returns?)|risk[\s-]*free|forex\s*signals?|crypto\s*(profit|investment)|invest\s*\w*\s*and\s*(get|earn))\b/gi },
    { w: 3, name: 'Job offer that sounds too easy', why: 'Fake recruiters promise jobs abroad, in the forces or online "likes" jobs, then ask for money.', re: /\b(job\s*(abroad|in\s*(dubai|qatar|saudi|canada|uk))|overseas\s*(job|employment)|kazi\s*(ya\s*)?(nje|majuu)|recruitment\s*(is\s*)?(ongoing|open)|earn\s*ksh?\s*[\d,]+\s*(daily|per\s*day)|like\s*(and|&)\s*earn|work\s*from\s*home\s*and\s*earn)\b/gi },
    { w: 2, name: 'Pretends to be a known organisation', why: 'Fraudsters borrow trusted names. Official M-PESA messages come from "MPESA", not a 07 or 01 number. Check on the official website or call the official line.', re: /\b(safaricom|m-?pesa\s*customer\s*care|customer\s*care|kra|helb|sha|nhif|kdf|kenya\s*defence|ntsa|ecitizen|equity|kcb|co-?op(erative)?\s*bank|airtel\s*money|ministry\s*of)\b/gi },
    { w: 2, name: 'Send money to a personal number', why: 'Being asked to send money to an ordinary mobile number, instead of an official paybill, is a red flag.', re: /\b(send|tuma|transfer|deposit)\b[^.\n]{0,40}\b(0?7\d{8}|0?1\d{8}|\+?2547\d{8}|\+?2541\d{8})\b/gi },
    { w: 2, name: 'Strange or shortened link', why: 'Short links hide where they lead. Official services use their own addresses such as .go.ke or the company\'s website.', re: /\b(bit\.ly|tinyurl\.com|cutt\.ly|t\.co|shorturl\.at|rb\.gy|is\.gd|wa\.me\/\d+|[a-z0-9-]+\.(xyz|top|click|link|info|online|site|live|buzz))\b\S*/gi },
    { w: 2, name: 'Your account will be blocked', why: 'Threats that your line, account or M-PESA will be suspended are used to scare you into acting.', re: /\b(will\s*be\s*(blocked|suspended|deactivated|closed)|account\s*(is\s*)?(blocked|suspended|locked)|line\s*(will\s*be\s*)?(blocked|deactivated)|itafungwa)\b/gi },
    { w: 1, name: 'Loan already "approved"', why: 'Real lenders do not approve loans you did not apply for, and never charge to release them.', re: /\b(loan\s*(has\s*been\s*)?(approved|qualified|limit\s*of)|you\s*qualify\s*for\s*(a\s*)?loan|mkopo)\b/gi },
    { w: 1, name: 'Generic greeting', why: 'Real companies usually use your name. "Dear customer" in a money request is a warning sign.', re: /\b(dear\s*(customer|client|user|sir\/madam|valued)|hello\s*dear)\b/gi },
  ];
  var $ = function (id) { return document.getElementById(id); };
  var escH = function (s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  function analyse(text) {
    var hits = [], ranges = [], score = 0;
    RULES.forEach(function (r) { r.re.lastIndex = 0; var m, found = false; while ((m = r.re.exec(text))) { found = true; ranges.push([m.index, m.index + m[0].length]); if (!m[0].length) r.re.lastIndex++; } if (found) { hits.push(r); score += r.w; } });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var out = '', pos = 0; ranges.forEach(function (g) { if (g[0] < pos) return; out += escH(text.slice(pos, g[0])) + '<mark>' + escH(text.slice(g[0], g[1])) + '</mark>'; pos = g[1]; }); out += escH(text.slice(pos));
    return { hits: hits, score: score, html: out };
  }
  $('check').onclick = function () {
    var t = $('msg').value.trim(); if (!t) { $('msg').focus(); return; }
    var r = analyse(t), lvl = r.score >= 7 ? 2 : r.score >= 3 ? 1 : 0;
    var col = ['#14c784', '#f4b631', '#ef4b5a'][lvl], pct = Math.min(100, 12 + r.score * 9);
    $('result').hidden = false; $('bar').style.width = pct + '%'; $('bar').style.background = col;
    $('verdict').style.color = col;
    $('verdict').textContent = lvl === 2 ? 'High risk: ' + r.hits.length + ' warning signs' : lvl === 1 ? 'Be careful: ' + r.hits.length + ' warning sign' + (r.hits.length > 1 ? 's' : '') : 'No common warning signs found';
    $('marked').innerHTML = r.html;
    $('flags').innerHTML = r.hits.map(function (h) { return '<div class="flag"><div><b>' + h.name + '.</b> ' + h.why + '</div></div>'; }).join('') || '<div class="note ok">We did not spot the usual tricks. Still, never share your PIN, and confirm anything about money on the official number.</div>';
    window.TNP_LAST_CHECK = { text: t, kinds: r.hits.map(function (h) { return h.name; }), score: r.score };
    $('rstatus').innerHTML = '';
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('clear').onclick = function () { $('msg').value = ''; $('result').hidden = true; };
  $('report').onclick = function () { if (window.TNP_reportScam) window.TNP_reportScam(window.TNP_LAST_CHECK); };
})();
