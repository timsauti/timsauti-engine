document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-copy]'); if (!b) return;
  var t = b.getAttribute('data-copy');
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { var o = b.innerHTML; b.textContent = 'Link copied'; setTimeout(function () { b.innerHTML = o; }, 1600); }).catch(function () { prompt('Copy this link', t); });
});
