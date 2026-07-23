/* 앳홈 채용 콘텐츠 워크스페이스 — 공유 로그인 게이트
 * 모든 뷰(index.html, dashboard.html, calendar.html, utm.html, cardnews-editor.html, ideas.html)의
 * <head> 최상단에서 이 스크립트를 로드해야 함.
 */
(function () {
  'use strict';

  var firebaseConfig = {
    apiKey: 'AIzaSyCD1QYYuHgfIrqHf9iVlQGLM8Ppqadxx3c',
    authDomain: 'athome-contents-workspace.firebaseapp.com',
    projectId: 'athome-contents-workspace',
    appId: '1:291977900858:web:c8660aaff0ee91c95a9603'
  };
  var ALLOWED_DOMAIN = '@athomecorp.com';

  // 앱 전체 로그인 게이트를 통과하는 순간 콘텐츠 캘린더의 Sheets 쓰기 권한도 함께 받아온다.
  // (앱을 쓸 수 있다는 것 자체가 이미 회사 계정 인증을 의미하므로, 캘린더에 별도 로그인 버튼을 두지 않는다.)
  var SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

  var hideStyle = document.createElement('style');
  hideStyle.setAttribute('data-athome-auth', '1');
  hideStyle.textContent = 'body{visibility:hidden!important;}#athome-auth-gate{visibility:visible!important;}';
  document.documentElement.appendChild(hideStyle);

  var gateEl = null;
  function ensureGate() {
    if (gateEl) return gateEl;
    gateEl = document.createElement('div');
    gateEl.id = 'athome-auth-gate';
    gateEl.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;' +
      'justify-content:center;flex-direction:column;gap:14px;background:#F5F4F1;' +
      'font-family:"Pretendard Variable",Pretendard,-apple-system,sans-serif;color:#1A1714;' +
      'text-align:center;padding:24px;';
    (document.body || document.documentElement).appendChild(gateEl);
    return gateEl;
  }

  function showSetupNeeded() {
    var el = ensureGate();
    el.style.display = 'flex';
    el.innerHTML =
      '<div style="font-size:34px;">🔧</div>' +
      '<div style="font-size:16px;font-weight:800;">Firebase 설정이 필요해요</div>' +
      '<div style="font-size:13px;color:#6B6660;max-width:320px;line-height:1.6;">' +
      'auth.js의 firebaseConfig 값을 실제 Firebase 프로젝트 값으로 채워야 로그인 게이트가 동작합니다.</div>';
  }

  function showLoginScreen(message) {
    var el = ensureGate();
    el.style.display = 'flex';
    el.innerHTML =
      '<div style="width:52px;height:52px;border-radius:14px;background:#1A1A1A;display:flex;' +
      'align-items:center;justify-content:center;font-size:22px;">🔒</div>' +
      '<div style="font-size:17px;font-weight:800;">앳홈 채용 콘텐츠 워크스페이스</div>' +
      '<div style="font-size:13px;color:#6B6660;">회사 Google 계정(' + ALLOWED_DOMAIN + ')으로 로그인해주세요</div>' +
      (message
        ? '<div style="font-size:12.5px;color:#DC2626;font-weight:700;">' + message + '</div>'
        : '') +
      '<button id="athome-auth-signin" style="border:0;border-radius:10px;padding:12px 22px;' +
      'background:#FF5D00;color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;">Google 계정으로 로그인</button>';
    var btn = el.querySelector('#athome-auth-signin');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = '로그인 중…';
      window.__athomeSignIn__().catch(function (err) {
        showLoginScreen('로그인에 실패했어요: ' + (err && err.message ? err.message : '알 수 없는 오류'));
      });
    });
  }

  function closeGate() {
    if (gateEl) gateEl.style.display = 'none';
    hideStyle.textContent = '#athome-auth-gate{visibility:visible!important;}';
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  var isPlaceholder = /REPLACE_ME/.test(firebaseConfig.apiKey);

  function boot() {
    if (isPlaceholder) {
      showSetupNeeded();
      return;
    }
    loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js')
      .then(function () {
        return loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js');
      })
      .then(function () {
        // 아이디어 노트처럼 Firestore가 필요한 페이지만 이 플래그를 auth.js 로드 직후에 세워둔다.
        return window.__athomeNeedsFirestore__
          ? loadScript('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js')
          : null;
      })
      .then(function () {
        firebase.initializeApp(firebaseConfig);
        if (window.__athomeNeedsFirestore__) {
          window.__athomeDb__ = firebase.firestore();
        }
        var provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ hd: 'athomecorp.com' });
        provider.addScope(SHEETS_SCOPE);

        window.__athomeSignIn__ = function () {
          return firebase.auth().signInWithPopup(provider).then(function (result) {
            var cred = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
            window.__athomeSheetsToken__ = cred && cred.accessToken;
            return result;
          });
        };
        window.__athomeSignOut__ = function () {
          window.__athomeSheetsToken__ = null;
          return firebase.auth().signOut();
        };

        // signOut()은 비동기라 도메인 거부 메시지를 보여준 직후 onAuthStateChanged(null)이
        // 다시 호출되며 화면을 덮어쓴다. pendingMessage에 담아 그 재호출 때 그대로 이어서 보여준다.
        var pendingMessage = null;
        firebase.auth().onAuthStateChanged(function (user) {
          if (!user) {
            window.__athomeUser__ = null;
            showLoginScreen(pendingMessage);
            pendingMessage = null;
            return;
          }
          var email = (user.email || '').toLowerCase();
          if (email.slice(-ALLOWED_DOMAIN.length) !== ALLOWED_DOMAIN) {
            window.__athomeUser__ = null;
            pendingMessage = '회사 계정(' + ALLOWED_DOMAIN + ')으로만 로그인할 수 있어요.';
            showLoginScreen(pendingMessage);
            firebase.auth().signOut();
            return;
          }
          window.__athomeUser__ = user;
          closeGate();
          document.dispatchEvent(new CustomEvent('athome-auth-ready', { detail: user }));
        });
      })
      .catch(function (err) {
        showLoginScreen('인증 스크립트를 불러오지 못했어요.');
        console.error('[auth] load failed', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
