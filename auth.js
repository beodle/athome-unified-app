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
  // 캘린더의 Sheets 편집 로그인과 동일한 OAuth 클라이언트 — 이미 이 origin(GitHub Pages)에서
  // 문제없이 동작이 확인된 값이라 재사용한다.
  var GIS_CLIENT_ID = '956471338785-o7697b8kivvo5lvtrr7bamogc0vkaqal.apps.googleusercontent.com';

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
      '<div id="athome-auth-gsi-btn"></div>';
    // Google Identity Services가 자기 버튼을 그려넣는다 (window.__athomeRenderSignInButton__은
    // boot()의 Firebase/GIS 스크립트 로드가 끝난 뒤에 정의되므로, 그 전에 게이트가 먼저
    // 보여지는 경우를 대비해 방어적으로 확인한다).
    if (window.__athomeRenderSignInButton__) {
      window.__athomeRenderSignInButton__(el.querySelector('#athome-auth-gsi-btn'));
    }
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
        // Firebase의 signInWithPopup/signInWithRedirect는 둘 다 GitHub Pages에서 실패했다
        // (COOP 헤더를 못 줘서 팝업 통신이 막히거나, 리다이렉트 결과를 받아올 제3자 저장소
        // 접근이 막힘). 대신 캘린더의 Sheets 편집 로그인과 같은 Google Identity Services(GIS)
        // 버튼으로 신원만 먼저 받고, 그 ID 토큰을 Firebase 자격증명으로 변환해
        // signInWithCredential(순수 API 호출, 팝업/리다이렉트 불필요)로 로그인한다.
        return loadScript('https://accounts.google.com/gsi/client');
      })
      .then(function () {
        firebase.initializeApp(firebaseConfig);
        if (window.__athomeNeedsFirestore__) {
          window.__athomeDb__ = firebase.firestore();
        }

        google.accounts.id.initialize({
          client_id: GIS_CLIENT_ID,
          hd: 'athomecorp.com',
          callback: function (response) {
            var cred = firebase.auth.GoogleAuthProvider.credential(response.credential);
            firebase.auth().signInWithCredential(cred).catch(function (err) {
              console.error('[auth] signInWithCredential failed', err);
              showLoginScreen('로그인에 실패했어요: ' + (err && err.message ? err.message : '알 수 없는 오류'));
            });
          }
        });

        window.__athomeRenderSignInButton__ = function (container) {
          google.accounts.id.renderButton(container, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
        };
        window.__athomeSignOut__ = function () {
          return firebase.auth().signOut();
        };
      })
      .then(function () {
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
