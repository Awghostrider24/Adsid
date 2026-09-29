/* ============================================================
   ABSENSI FRONTEND - FULL REPLACEMENT
   ============================================================
   Compatible actions:
   - firebaseLogin
   - profile
   - history
   - attendance
   - location
   - requests
   - submitRequest
   - assignments
   - status

   Dependencies:
   - CONFIG.WEB_APP_URL
   - CONFIG.FIREBASE_CONFIG
   - Existing HTML element IDs
   ============================================================ */

'use strict';

/* ============================================================
   GLOBAL STATE
   ============================================================ */

let sessionToken = localStorage.getItem('absen_session') || '';

let currentUser = null;
let currentLocation = null;
let cameraStream = null;

let facingMode = 'user';
let attendanceType = 'MASUK';
let capturedDataUrl = '';

let loginProcessing = false;
let attendanceProcessing = false;

let firebaseApp = null;
let firebaseAuth = null;
let firebaseGoogleProvider = null;
let firebaseReady = false;

let firebaseModulesPromise = null;
let firebaseInitPromise = null;

let locationInFlight = false;
let lastLocationAt = 0;
let locationLookupKey = '';

const CLIENT_CACHE = Object.create(null);
const CLIENT_INFLIGHT = Object.create(null);

const CACHE_TTL = Object.freeze({
  profile: 5 * 60 * 1000,
  history: 20 * 1000,
  requests: 30 * 1000,
  assignments: 30 * 1000,
  location: 5 * 60 * 1000
});

const $ = id => document.getElementById(id);


/* ============================================================
   CACHE
   ============================================================ */

function cacheGet_(key, ttl) {
  const item = CLIENT_CACHE[key];

  if (!item) {
    return null;
  }

  if (Date.now() - item.at > ttl) {
    delete CLIENT_CACHE[key];
    return null;
  }

  return item.value;
}

function cacheSet_(key, value) {
  CLIENT_CACHE[key] = {
    at: Date.now(),
    value
  };

  return value;
}

function cacheClear_(key) {
  if (key) {
    delete CLIENT_CACHE[key];
  }
}

function cacheClearAll_() {
  Object.keys(CLIENT_CACHE).forEach(key => {
    delete CLIENT_CACHE[key];
  });
}


/* ============================================================
   UTILITY
   ============================================================ */

function makeId() {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === 'function'
  ) {
    return window.crypto
      .randomUUID()
      .replaceAll('-', '');
  }

  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36)
  );
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]
  );
}

function esc_(value) {
  return escapeHtml(value);
}

function safeText_(id, value) {
  const el = $(id);

  if (el) {
    el.textContent = String(value ?? '');
  }

  return el;
}

function safeHtml_(id, html) {
  const el = $(id);

  if (el) {
    el.innerHTML = String(html ?? '');
  }

  return el;
}


/* ============================================================
   TOAST
   ============================================================ */

function showToast(message) {
  const toast = $('toast');

  if (!toast) {
    return;
  }

  toast.textContent = String(message || '');

  toast.classList.add('show');

  clearTimeout(window.toastTimer);

  window.toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}


/* ============================================================
   LOADING
   ============================================================ */

function loading(
  on,
  title = 'Memproses...',
  text = 'Mohon tunggu sebentar.'
) {
  const loadingEl = $('loading');

  if (!loadingEl) {
    return;
  }

  safeText_('loadingTitle', title);
  safeText_('loadingText', text);

  loadingEl.classList.toggle('show', !!on);
}


/* ============================================================
   FIREBASE
   ============================================================ */

async function validConfig() {
  const config = window.CONFIG || {};
  const firebaseConfig = config.FIREBASE_CONFIG || {};

  return (
    typeof config.WEB_APP_URL === 'string' &&
    config.WEB_APP_URL.startsWith('https://') &&

    firebaseConfig.apiKey &&
    !String(firebaseConfig.apiKey).startsWith('PASTE_') &&

    firebaseConfig.projectId &&
    !String(firebaseConfig.projectId).startsWith('PASTE_') &&

    firebaseConfig.appId &&
    !String(firebaseConfig.appId).startsWith('PASTE_')
  );
}

function loadFirebaseModules_() {
  if (firebaseModulesPromise) {
    return firebaseModulesPromise;
  }

  firebaseModulesPromise = Promise.all([
    import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'
    ),

    import(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'
    )
  ])
    .then(([appModule, authModule]) => ({
      ...appModule,
      ...authModule
    }))
    .catch(error => {
      firebaseModulesPromise = null;
      throw error;
    });

  return firebaseModulesPromise;
}

async function initFirebase(showLoading = false) {
  if (firebaseReady) {
    return true;
  }

  if (firebaseInitPromise) {
    return firebaseInitPromise;
  }

  firebaseInitPromise = (async () => {
    if (showLoading) {
      loading(
        true,
        'Menyiapkan Login',
        'Menghubungkan sistem autentikasi...'
      );
    }

    if (!(await validConfig())) {
      if (showLoading) {
        loading(false);
      }

      showToast(
        'Konfigurasi Firebase belum lengkap.'
      );

      firebaseInitPromise = null;

      return false;
    }

    try {
      const {
        initializeApp,
        getApps,
        getAuth,
        GoogleAuthProvider,
        onAuthStateChanged
      } = await loadFirebaseModules_();

      const config = window.CONFIG || {};

      firebaseApp =
        getApps().length > 0
          ? getApps()[0]
          : initializeApp(
              config.FIREBASE_CONFIG
            );

      firebaseAuth = getAuth(firebaseApp);

      firebaseGoogleProvider =
        new GoogleAuthProvider();

      firebaseGoogleProvider.setCustomParameters({
        prompt: 'select_account'
      });

      firebaseReady = true;

      onAuthStateChanged(
        firebaseAuth,
        async user => {
          if (
            !user ||
            loginProcessing ||
            sessionToken
          ) {
            return;
          }

          try {
            loginProcessing = true;

            loading(
              true,
              'Memverifikasi Akun',
              'Menghubungkan akun Google dengan data pegawai...'
            );

            await completeFirebaseLogin_(user);

          } catch (error) {
            console.error(
              'Firebase auth state error:',
              error
            );

            loginProcessing = false;

            loading(false);

            restoreLoginButton_();

            showToast(
              error?.message ||
              'Login Firebase gagal.'
            );
          }
        }
      );

      if (showLoading) {
        loading(false);
      }

      return true;

    } catch (error) {
      console.error(
        'Firebase Init Error:',
        error
      );

      firebaseReady = false;
      firebaseInitPromise = null;

      if (showLoading) {
        loading(false);
      }

      showToast(
        'Firebase gagal dimuat. Periksa konfigurasi dan Authorized Domains.'
      );

      return false;
    }
  })();

  return firebaseInitPromise;
}


/* ============================================================
   FIREBASE LOGIN
   ============================================================ */

async function loginWithFirebase() {
  if (loginProcessing) {
    return;
  }

  loginProcessing = true;

  const button = $('firebaseLoginButton');

  if (button) {
    button.disabled = true;

    button.innerHTML = `
      <span class="material-symbols-rounded">
        progress_activity
      </span>
      Menghubungkan...
    `;
  }

  try {
    const ready = await initFirebase(true);

    if (!ready) {
      loginProcessing = false;
      restoreLoginButton_();
      return;
    }

    loading(
      true,
      'Memverifikasi Akun',
      'Menghubungkan akun Google dengan data pegawai...'
    );

    const {
      signInWithPopup,
      signInWithRedirect
    } = await loadFirebaseModules_();

    let credentialResult;

    try {
      credentialResult =
        await signInWithPopup(
          firebaseAuth,
          firebaseGoogleProvider
        );

    } catch (popupError) {
      console.warn(
        'Popup login gagal:',
        popupError
      );

      const fallbackCodes = [
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request'
      ];

      if (
        fallbackCodes.includes(
          popupError?.code
        )
      ) {
        loading(
          true,
          'Membuka Login Google',
          'Silakan pilih akun Google Anda...'
        );

        await signInWithRedirect(
          firebaseAuth,
          firebaseGoogleProvider
        );

        return;
      }

      throw popupError;
    }

    if (credentialResult?.user) {
      await completeFirebaseLogin_(
        credentialResult.user
      );
    }

  } catch (error) {
    console.error(
      'Firebase Login Error:',
      error
    );

    loginProcessing = false;

    restoreLoginButton_();

    loading(false);

    showToast(
      firebaseErrorMessage_(error)
    );
  }
}

function restoreLoginButton_() {
  const button = $('firebaseLoginButton');

  if (!button) {
    return;
  }

  button.disabled = false;

  button.innerHTML = `
    <span class="google-icon">
      G
    </span>

    <span>
      Masuk dengan Google
    </span>
  `;
}

async function completeFirebaseLogin_(user) {
  if (!user) {
    throw new Error(
      'Akun Firebase tidak ditemukan.'
    );
  }

  loading(
    true,
    'Memverifikasi Akun',
    'Menghubungkan akun Google dengan data pegawai...'
  );

  const firebaseIdToken =
    await user.getIdToken();

  const requestId = makeId();

  const sent = await postForm({
    action: 'firebaseLogin',
    requestId,
    firebaseIdToken
  });

  if (!sent) {
    throw new Error(
      'Tidak dapat mengirim data login ke server.'
    );
  }

  poll(
    requestId,
    result => {
      loginProcessing = false;

      restoreLoginButton_();

      if (!result?.ok) {
        loading(false);

        showToast(
          result?.error ||
          'Login gagal. Pastikan akun terdaftar.'
        );

        return;
      }

      const newToken =
        result.sessionToken || '';

      if (!newToken) {
        loading(false);

        showToast(
          'Server tidak memberikan sesi login.'
        );

        return;
      }

      sessionToken = newToken;

      localStorage.setItem(
        'absen_session',
        sessionToken
      );

      currentUser =
        result.user || null;

      if (currentUser) {
        cacheSet_(
          'profile',
          currentUser
        );
      }

      showApp();

      loading(false);

      refreshAll({
        initial: true
      });
    }
  );
}

function firebaseErrorMessage_(error) {
  const code =
    String(error?.code || '');

  const messages = {
    'auth/popup-blocked':
      'Popup login diblokir browser. Izinkan popup lalu coba lagi.',

    'auth/popup-closed-by-user':
      'Jendela login ditutup sebelum selesai.',

    'auth/cancelled-popup-request':
      'Proses login sedang berjalan.',

    'auth/unauthorized-domain':
      'Domain aplikasi belum ditambahkan ke Authorized Domains Firebase.',

    'auth/operation-not-allowed':
      'Login Google belum diaktifkan di Firebase Authentication.',

    'auth/network-request-failed':
      'Koneksi internet bermasalah. Periksa jaringan Anda.'
  };

  return (
    messages[code] ||
    error?.message ||
    'Login Firebase gagal.'
  );
}


/* ============================================================
   SERVER COMMUNICATION
   ============================================================ */

async function postForm(fields) {
  const config = window.CONFIG || {};

  if (
    !config.WEB_APP_URL ||
    typeof config.WEB_APP_URL !== 'string'
  ) {
    console.error(
      'CONFIG.WEB_APP_URL tidak tersedia.'
    );

    return false;
  }

  const body = new URLSearchParams();

  Object.entries(fields || {})
    .forEach(([key, value]) => {
      body.append(
        key,
        value ?? ''
      );
    });

  try {
    await fetch(
      config.WEB_APP_URL,
      {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: body.toString(),
        redirect: 'follow',
        keepalive: true
      }
    );

    return true;

  } catch (error) {
    console.error(
      'POST Apps Script gagal:',
      error
    );

    /*
     * Fallback menggunakan form HTML.
     * Berguna untuk browser tertentu / kondisi jaringan
     * yang bermasalah dengan fetch no-cors.
     */

    try {
      let frame =
        document.getElementById(
          'postFrame'
        );

      if (!frame) {
        frame =
          document.createElement(
            'iframe'
          );

        frame.id = 'postFrame';
        frame.name = 'postFrame';
        frame.style.display = 'none';

        document.body.appendChild(
          frame
        );
      }

      const form =
        document.createElement(
          'form'
        );

      form.method = 'POST';
      form.action = config.WEB_APP_URL;
      form.target = 'postFrame';
      form.style.display = 'none';

      Object.entries(fields || {})
        .forEach(([key, value]) => {
          const input =
            document.createElement(
              'input'
            );

          input.type = 'hidden';
          input.name = key;
          input.value = value ?? '';

          form.appendChild(input);
        });

      document.body.appendChild(form);

      form.submit();

      setTimeout(() => {
        try {
          form.remove();
        } catch (_) {}
      }, 1500);

      return true;

    } catch (fallbackError) {
      console.error(
        'Fallback POST gagal:',
        fallbackError
      );

      return false;
    }
  }
}


/* ============================================================
   JSONP POLLING
   ============================================================ */

function poll(
  requestId,
  onDone,
  tries = 0
) {
  const config = window.CONFIG || {};

  const MAX_TRIES = 45;

  const delays = [
    100,
    150,
    200,
    250,
    300,
    400,
    500,
    650,
    800,
    1000,
    1200,
    1400,
    1600,
    1800,
    2000
  ];

  const callbackName =
    'cb_' + makeId();

  let finished = false;
  let timer = null;
  let script = null;

  function cleanup() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    try {
      delete window[callbackName];
    } catch (_) {}

    if (script) {
      try {
        script.onload = null;
        script.onerror = null;
        script.remove();
      } catch (_) {}

      script = null;
    }

    const duplicate =
      document.getElementById(
        'jsonp_' + callbackName
      );

    if (duplicate) {
      try {
        duplicate.remove();
      } catch (_) {}
    }
  }

  function finish(result) {
    if (finished) {
      return;
    }

    finished = true;

    cleanup();

    try {
      onDone(result);
    } catch (error) {
      console.error(
        'Poll callback error:',
        error
      );
    }
  }

  function retry(nextTry, delay) {
    if (finished) {
      return;
    }

    if (nextTry >= MAX_TRIES) {
      finish({
        ok: false,
        error:
          'Server belum memberikan respons. Coba lagi. Jika masalah terus terjadi di Chrome HP, periksa koneksi internet dan Apps Script.'
      });

      return;
    }

    cleanup();

    timer = setTimeout(() => {
      poll(
        requestId,
        onDone,
        nextTry
      );
    }, delay);
  }

  window[callbackName] = data => {
    if (finished) {
      return;
    }

    if (
      data &&
      data.state === 'DONE'
    ) {
      finish(
        data.result || data
      );

      return;
    }

    retry(
      tries + 1,
      delays[
        Math.min(
          tries,
          delays.length - 1
        )
      ]
    );
  };

  script =
    document.createElement(
      'script'
    );

  script.id =
    'jsonp_' + callbackName;

  script.async = true;

  script.src =
    String(
      config.WEB_APP_URL
    ) +
    '?action=status' +
    '&requestId=' +
    encodeURIComponent(
      requestId
    ) +
    '&callback=' +
    encodeURIComponent(
      callbackName
    ) +
    '&_=' +
    Date.now();

  script.onerror = () => {
    if (finished) {
      return;
    }

    retry(
      tries + 1,
      Math.min(
        2000,
        250 + tries * 100
      )
    );
  };

  document.body.appendChild(
    script
  );
}


/* ============================================================
   REQUEST WRAPPER
   ============================================================ */

function request(
  action,
  extra = {},
  onDone
) {
  const callback =
    typeof onDone === 'function'
      ? onDone
      : () => {};

  const payloadExtra =
    extra || {};

  const requestId =
    makeId();

  const payload = {
    action,
    requestId,
    sessionToken,
    ...payloadExtra
  };

  const dedupeActions = {
    profile: true,
    history: true,
    requests: true,
    assignments: true,
    location: true
  };

  const dedupeKey =
    dedupeActions[action]
      ? (
          action +
          ':' +
          JSON.stringify(
            payloadExtra
          )
        )
      : '';

  if (
    dedupeKey &&
    CLIENT_INFLIGHT[dedupeKey]
  ) {
    CLIENT_INFLIGHT[
      dedupeKey
    ].then(callback);

    return CLIENT_INFLIGHT[
      dedupeKey
    ];
  }

  const promise =
    Promise.resolve()
      .then(() =>
        postForm(payload)
      )
      .then(sent => {
        if (sent === false) {
          return {
            ok: false,
            error:
              'Gagal mengirim permintaan ke server.'
          };
        }

        return new Promise(resolve => {
          poll(
            requestId,
            resolve,
            0
          );
        });
      })
      .catch(error => ({
        ok: false,
        error:
          error?.message ||
          'Terjadi kesalahan komunikasi dengan server.'
      }));

  if (dedupeKey) {
    CLIENT_INFLIGHT[
      dedupeKey
    ] = promise;

    promise.finally(() => {
      setTimeout(() => {
        if (
          CLIENT_INFLIGHT[
            dedupeKey
          ] === promise
        ) {
          delete CLIENT_INFLIGHT[
            dedupeKey
          ];
        }
      }, 0);
    });
  }

  promise.then(callback);

  return promise;
}

function requestPromise_(
  action,
  extra = {}
) {
  return new Promise(resolve => {
    request(
      action,
      extra,
      resolve
    );
  });
}


/* ============================================================
   APP VIEW
   ============================================================ */

function showApp() {
  const loginView = $('loginView');
  const appView = $('appView');

  if (loginView) {
    loginView.style.display =
      'none';
  }

  if (appView) {
    appView.style.display =
      'block';
  }

  if (currentUser) {
    renderUser(
      currentUser
    );
  }
}

function renderUser(user) {
  if (!user) {
    return;
  }

  const name =
    user.name || '-';

  safeText_(
    'userName',
    name
  );

  safeText_(
    'userPosition',
    [
      user.position,
      user.role
    ]
      .filter(Boolean)
      .join(' • ') || '-'
  );

  safeText_(
    'profileName',
    name
  );

  safeText_(
    'profilePosition',
    user.position || '-'
  );

  safeText_(
    'profileNip',
    user.nip || '-'
  );

  safeText_(
    'profileEmail',
    user.email || '-'
  );

  safeText_(
    'profileRole',
    user.role || '-'
  );

  safeText_(
    'profileStatus',
    user.status || '-'
  );

  const photo =
    user.photo || '';

  const avatar =
    photo ||
    avatarData(
      name
    );

  const avatarEl =
    $('avatar');

  const profilePhoto =
    $('profilePhoto');

  if (avatarEl) {
    avatarEl.src = avatar;
  }

  if (profilePhoto) {
    profilePhoto.src =
      avatar;
  }

  updateGreeting_();
}

function avatarData(name) {
  const initial =
    String(
      name || '?'
    )
      .charAt(0)
      .toUpperCase();

  const svg = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
    >
      <rect
        width="100%"
        height="100%"
        rx="45"
        fill="#eaf3ff"
      />

      <text
        x="50%"
        y="58%"
        text-anchor="middle"
        font-family="Arial"
        font-size="82"
        font-weight="700"
        fill="#1769e0"
      >
        ${escapeHtml(initial)}
      </text>
    </svg>
  `;

  return (
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(svg)
  );
}


/* ============================================================
   GREETING + CLOCK
   ============================================================ */

function updateGreeting_() {
  const hour = Number(
    new Intl.DateTimeFormat(
      'en-US',
      {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
      }
    )
      .format(
        new Date()
      )
  );

  let greeting =
    'Selamat Datang';

  if (
    hour >= 4 &&
    hour < 11
  ) {
    greeting =
      'Selamat Pagi';

  } else if (
    hour >= 11 &&
    hour < 15
  ) {
    greeting =
      'Selamat Siang';

  } else if (
    hour >= 15 &&
    hour < 18
  ) {
    greeting =
      'Selamat Sore';

  } else {
    greeting =
      'Selamat Malam';
  }

  safeText_(
    'greetingText',
    greeting
  );
}

function updateClock() {
  const dateEl =
    $('dateText');

  const clockEl =
    $('clockText');

  if (
    !dateEl ||
    !clockEl
  ) {
    return;
  }

  const now =
    new Date();

  dateEl.textContent =
    new Intl.DateTimeFormat(
      'id-ID',
      {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Jakarta'
      }
    )
      .format(now);

  const time =
    new Intl.DateTimeFormat(
      'id-ID',
      {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
      }
    )
      .format(now);

  clockEl.innerHTML =
    escapeHtml(time) +
    ' <span>WIB</span>';

  updateGreeting_();
}


/* ============================================================
   LOCATION
   ============================================================ */

function getLocation(force = false) {
  if (
    !navigator.geolocation
  ) {
    safeText_(
      'locationText',
      'Browser tidak mendukung GPS'
    );

    safeText_(
      'accuracyText',
      'Gunakan browser yang mendukung lokasi.'
    );

    return Promise.resolve(null);
  }

  if (
    !force &&
    currentLocation &&
    Date.now() -
      lastLocationAt <
      CACHE_TTL.location
  ) {
    return Promise.resolve(
      currentLocation
    );
  }

  if (locationInFlight) {
    return Promise.resolve(
      currentLocation
    );
  }

  locationInFlight = true;

  safeText_(
    'locationText',
    'Mengambil lokasi...'
  );

  safeText_(
    'accuracyText',
    'Mohon izinkan lokasi pada browser.'
  );

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        currentLocation = {
          latitude:
            Number(
              position.coords.latitude
            ),

          longitude:
            Number(
              position.coords.longitude
            ),

          accuracy:
            Number(
              position.coords.accuracy
            )
        };

        lastLocationAt =
          Date.now();

        safeText_(
          'accuracyText',
          'Akurasi GPS: ' +
          Math.round(
            currentLocation.accuracy
          ) +
          ' meter'
        );

        const key =
          currentLocation.latitude.toFixed(4) +
          ',' +
          currentLocation.longitude.toFixed(4);

        if (
          key ===
          locationLookupKey
        ) {
          locationInFlight =
            false;

          resolve(
            currentLocation
          );

          return;
        }

        locationLookupKey =
          key;

        const cached =
          cacheGet_(
            'location:' + key,
            CACHE_TTL.location
          );

        if (cached) {
          Object.assign(
            currentLocation,
            cached
          );

          safeText_(
            'locationText',
            [
              cached.district,
              cached.regency
            ]
              .filter(Boolean)
              .join(', ') ||
            'Area lokasi belum terdeteksi.'
          );

          locationInFlight =
            false;

          resolve(
            currentLocation
          );

          return;
        }

        request(
          'location',
          {
            latitude:
              currentLocation.latitude,

            longitude:
              currentLocation.longitude
          },
          result => {
            if (result?.ok) {
              const data = {
                district:
                  result.district || '',

                regency:
                  result.regency || '',

                province:
                  result.province || ''
              };

              Object.assign(
                currentLocation,
                data
              );

              cacheSet_(
                'location:' + key,
                data
              );

              safeText_(
                'locationText',
                [
                  data.district,
                  data.regency
                ]
                  .filter(Boolean)
                  .join(', ') ||
                'Area lokasi belum terdeteksi.'
              );

            } else {
              safeText_(
                'locationText',
                'Area lokasi belum terdeteksi.'
              );
            }

            locationInFlight =
              false;

            resolve(
              currentLocation
            );
          }
        );
      },

      error => {
        currentLocation = null;

        locationInFlight =
          false;

        safeText_(
          'locationText',
          'Lokasi belum tersedia'
        );

        safeText_(
          'accuracyText',
          getLocationErrorMessage_(
            error
          )
        );

        resolve(null);
      },

      {
        enableHighAccuracy:
          !!force,

        timeout:
          force
            ? 8000
            : 5000,

        maximumAge:
          force
            ? 0
            : 120000
      }
    );
  });
}

function getLocationErrorMessage_(error) {
  if (!error) {
    return 'Aktifkan izin lokasi.';
  }

  if (error.code === 1) {
    return (
      'Izin lokasi ditolak. Aktifkan lokasi browser.'
    );
  }

  if (error.code === 2) {
    return (
      'Lokasi tidak tersedia. Pastikan GPS aktif.'
    );
  }

  if (error.code === 3) {
    return (
      'Pengambilan lokasi terlalu lama. Coba lagi.'
    );
  }

  return (
    error.message ||
    'Lokasi belum tersedia.'
  );
}


/* ============================================================
   DATE / TIME
   ============================================================ */

function formatAttendanceTime_(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '--:--';
  }

  const raw =
    String(value).trim();

  const clockMatch =
    raw.match(
      /\b(\d{1,2}):(\d{2})(?::\d{2})?\b/
    );

  if (clockMatch) {
    return (
      String(
        Number(
          clockMatch[1]
        )
      ).padStart(2, '0') +
      ':' +
      clockMatch[2]
    );
  }

  const shortMatch =
    raw.match(
      /^\s*(\d{1,2})[.: -](\d{2})\s*(?:WIB)?\s*$/i
    );

  if (shortMatch) {
    return (
      String(
        Number(
          shortMatch[1]
        )
      ).padStart(2, '0') +
      ':' +
      shortMatch[2]
    );
  }

  const parsed =
    new Date(raw);

  if (
    !Number.isNaN(
      parsed.getTime()
    )
  ) {
    return new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone:
          'Asia/Jakarta',

        hour:
          '2-digit',

        minute:
          '2-digit',

        hour12:
          false
      }
    )
      .format(parsed);
  }

  return '--:--';
}

function normalizeDate_(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '';
  }

  const raw =
    String(value).trim();

  const iso =
    raw.match(
      /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/
    );

  if (iso) {
    const year =
      Number(iso[1]);

    const month =
      Number(iso[2]);

    const day =
      Number(iso[3]);

    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return (
        year +
        '-' +
        String(month).padStart(2, '0') +
        '-' +
        String(day).padStart(2, '0')
      );
    }
  }

  const numeric =
    raw.match(
      /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/
    );

  if (numeric) {
    let a =
      Number(numeric[1]);

    let b =
      Number(numeric[2]);

    const year =
      Number(numeric[3]);

    let day = a;
    let month = b;

    if (
      a <= 12 &&
      b > 12
    ) {
      month = a;
      day = b;
    }

    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return (
        year +
        '-' +
        String(month).padStart(2, '0') +
        '-' +
        String(day).padStart(2, '0')
      );
    }
  }

  const parsed =
    new Date(raw);

  if (
    !Number.isNaN(
      parsed.getTime()
    )
  ) {
    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone:
            'Asia/Jakarta',

          year:
            'numeric',

          month:
            '2-digit',

          day:
            '2-digit'
        }
      )
        .formatToParts(
          parsed
        );

    const get =
      type =>
        parts.find(
          item =>
            item.type === type
        )?.value || '';

    if (
      get('year') &&
      get('month') &&
      get('day')
    ) {
      return (
        get('year') +
        '-' +
        get('month') +
        '-' +
        get('day')
      );
    }
  }

  return raw.slice(
    0,
    10
  );
}

function jakartaToday_() {
  const parts =
    new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone:
          'Asia/Jakarta',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit'
      }
    )
      .formatToParts(
        new Date()
      );

  const get =
    type =>
      parts.find(
        item =>
          item.type === type
      )?.value || '';

  return (
    get('year') +
    '-' +
    get('month') +
    '-' +
    get('day')
  );
}

function getDisplayDate_(value) {
  const normalized =
    normalizeDate_(
      value
    );

  if (!normalized) {
    return {
      day: '-',
      date: '-'
    };
  }

  const match =
    normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    return {
      day: '-',
      date: String(
        value || '-'
      )
    };
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  return {
    day:
      new Intl.DateTimeFormat(
        'id-ID',
        {
          weekday:
            'long',
          timeZone:
            'UTC'
        }
      )
        .format(date),

    date:
      new Intl.DateTimeFormat(
        'id-ID',
        {
          day:
            '2-digit',

          month:
            'long',

          year:
            'numeric',

          timeZone:
            'UTC'
        }
      )
        .format(date)
  };
}


/* ============================================================
   ATTENDANCE UI
   ============================================================ */

function attendanceTypeInfo_(type) {
  const value =
    String(
      type || ''
    )
      .trim()
      .toUpperCase();

  if (value === 'MASUK') {
    return {
      label:
        'Absen Masuk',
      icon:
        'login',
      className:
        'masuk'
    };
  }

  if (value === 'PULANG') {
    return {
      label:
        'Absen Pulang',
      icon:
        'logout',
      className:
        'pulang'
    };
  }

  return {
    label:
      type ||
      'Absensi',

    icon:
      'check_circle',

    className:
      'masuk'
  };
}

function renderTodayAttendanceCard_(item) {
  const typeInfo =
    attendanceTypeInfo_(
      item.type
    );

  const dateInfo =
    getDisplayDate_(
      item.date
    );

  const location =
    [
      item.district,
      item.regency
    ]
      .filter(Boolean)
      .join(', ');

  const distance =
    item.distance !== undefined &&
    item.distance !== null &&
    item.distance !== '' &&
    Number.isFinite(
      Number(item.distance)
    )
      ? (
          Math.round(
            Number(
              item.distance
            )
          ) +
          ' meter dari titik kantor'
        )
      : 'Jarak tidak tersedia';

  return `
    <div class="today-card ${escapeHtml(typeInfo.className)}">

      <div class="today-head">

        <div class="today-title">

          <div class="today-type-icon">
            <span class="material-symbols-rounded">
              ${escapeHtml(typeInfo.icon)}
            </span>
          </div>

          <span>
            ${escapeHtml(typeInfo.label)}
          </span>

        </div>

        <span class="today-status">
          Tercatat
        </span>

      </div>

      <div class="today-grid">

        <div class="today-info">

          <div class="today-label">
            Hari
          </div>

          <div class="today-value">
            ${escapeHtml(dateInfo.day)}
          </div>

        </div>

        <div class="today-info">

          <div class="today-label">
            Tanggal
          </div>

          <div class="today-value">
            ${escapeHtml(dateInfo.date)}
          </div>

        </div>

        <div class="today-info">

          <div class="today-label">
            Jam
          </div>

          <div class="today-value today-time">
            ${escapeHtml(
              formatAttendanceTime_(
                item.time
              )
            )}
            WIB
          </div>

        </div>

        <div class="today-info">

          <div class="today-label">
            Status
          </div>

          <div class="today-value">
            ${escapeHtml(
              typeInfo.label
            )}
          </div>

        </div>

        <div class="today-info full">

          <div class="today-label">
            Lokasi
          </div>

          <div class="today-value today-location">

            <span class="material-symbols-rounded">
              location_on
            </span>

            <span>

              ${escapeHtml(
                location ||
                'Lokasi tercatat'
              )}

              <div class="today-distance">
                ${escapeHtml(
                  distance
                )}
              </div>

            </span>

          </div>

        </div>

      </div>

    </div>
  `;
}

function renderHistory(items) {
  items =
    Array.isArray(items)
      ? items
      : [];

  const today =
    jakartaToday_();

  const todayItems =
    items
      .filter(
        item =>
          normalizeDate_(
            item.date
          ) === today
      )
      .sort(
        (a, b) =>
          String(
            a.time || ''
          )
            .localeCompare(
              String(
                b.time || ''
              )
            )
      );

  const masuk =
    todayItems.find(
      item =>
        String(
          item.type || ''
        )
          .toUpperCase() ===
        'MASUK'
    );

  const pulang =
    todayItems.find(
      item =>
        String(
          item.type || ''
        )
          .toUpperCase() ===
        'PULANG'
    );

  const btnMasuk =
    $('btnMasuk');

  const btnPulang =
    $('btnPulang');

  if (btnMasuk) {
    btnMasuk.disabled =
      !!masuk;
  }

  if (btnPulang) {
    btnPulang.disabled =
      !masuk ||
      !!pulang;
  }

  if (
    masuk &&
    masuk.time
  ) {
    safeHtml_(
      'arrivalTime',
      escapeHtml(
        formatAttendanceTime_(
          masuk.time
        )
      ) +
      ' <span>WIB</span>'
    );
  } else {
    safeHtml_(
      'arrivalTime',
      '--:-- <span>WIB</span>'
    );
  }

  const badge =
    $('statusBadge');

  if (badge) {
    if (
      masuk &&
      pulang
    ) {
      badge.textContent =
        'Absensi Lengkap';

      badge.className =
        'status-badge ok';

      safeHtml_(
        'statusSymbol',
        `
          <span class="material-symbols-rounded">
            check_circle
          </span>
        `
      );

    } else if (masuk) {
      badge.textContent =
        'Sudah Absen Masuk';

      badge.className =
        'status-badge ok';

      safeHtml_(
        'statusSymbol',
        `
          <span class="material-symbols-rounded">
            check_circle
          </span>
        `
      );

    } else {
      badge.textContent =
        'Belum Absen';

      badge.className =
        'status-badge';

      safeHtml_(
        'statusSymbol',
        `
          <span class="material-symbols-rounded">
            login
          </span>
        `
      );
    }
  }

  if (
    todayItems.length
  ) {
    safeHtml_(
      'todayHistory',
      todayItems
        .map(
          renderTodayAttendanceCard_
        )
        .join('')
    );
  } else {
    safeHtml_(
      'todayHistory',
      `
        <div class="empty-today">

          <span class="material-symbols-rounded">
            event_available
          </span>

          Belum ada absensi hari ini.

          <br>

          Silakan lakukan Absen Masuk.

        </div>
      `
    );
  }

  if (items.length) {
    safeHtml_(
      'historyList',
      items
        .map(item => {
          const dateInfo =
            getDisplayDate_(
              item.date
            );

          const location =
            [
              item.district,
              item.regency
            ]
              .filter(Boolean)
              .join(', ');

          const distance =
            item.distance !== undefined &&
            item.distance !== null &&
            item.distance !== '' &&
            Number.isFinite(
              Number(
                item.distance
              )
            )
              ? (
                  Math.round(
                    Number(
                      item.distance
                    )
                  ) +
                  ' m'
                )
              : '';

          const typeInfo =
            attendanceTypeInfo_(
              item.type
            );

          return `
            <div class="history-item">

              <div class="history-date-icon">

                <span class="material-symbols-rounded">
                  ${escapeHtml(
                    typeInfo.icon
                  )}
                </span>

              </div>

              <div class="history-main">

                <div class="history-date">
                  ${escapeHtml(
                    dateInfo.date
                  )}
                </div>

                <div class="history-detail">

                  ${escapeHtml(
                    dateInfo.day
                  )}

                  •

                  ${escapeHtml(
                    typeInfo.label
                  )}

                  ${
                    location
                      ? ' • ' +
                        escapeHtml(
                          location
                        )
                      : ''
                  }

                </div>

              </div>

              <div class="history-right">

                <div class="history-time">

                  ${escapeHtml(
                    formatAttendanceTime_(
                      item.time
                    )
                  )}

                  WIB

                </div>

                <div class="history-distance">

                  ${escapeHtml(
                    distance
                  )}

                </div>

              </div>

            </div>
          `;
        })
        .join('')
    );

  } else {
    safeHtml_(
      'historyList',
      `
        <div class="empty-today">

          <span class="material-symbols-rounded">
            history
          </span>

          Belum ada riwayat absensi.

        </div>
      `
    );
  }
}


/* ============================================================
   REFRESH HOME
   ============================================================ */

async function refreshAll(
  options = {}
) {
  if (!sessionToken) {
    return;
  }

  /*
   * Profile
   */
  const cachedProfile =
    cacheGet_(
      'profile',
      CACHE_TTL.profile
    );

  if (
    !currentUser ||
    !cachedProfile
  ) {
    request(
      'profile',
      {},
      result => {
        if (
          result?.ok &&
          result.user
        ) {
          currentUser =
            result.user;

          cacheSet_(
            'profile',
            result.user
          );

          renderUser(
            currentUser
          );
        }
      }
    );

  } else {
    renderUser(
      currentUser
    );
  }

  /*
   * GPS tidak memblokir Home.
   */
  getLocation(false);

  /*
   * History
   */
  const cachedHistory =
    cacheGet_(
      'history',
      CACHE_TTL.history
    );

  if (cachedHistory) {
    renderHistory(
      cachedHistory
    );

  } else {
    request(
      'history',
      {
        limit: 60
      },
      result => {
        if (result?.ok) {
          const items =
            result.items || [];

          cacheSet_(
            'history',
            items
          );

          renderHistory(
            items
          );
        }
      }
    );
  }
}


/* ============================================================
   CAMERA
   ============================================================ */

async function openCamera(type) {
  if (attendanceProcessing) {
    return;
  }

  if (!currentLocation) {
    getLocation(true);

    showToast(
      'Lokasi sedang diambil. Tunggu sampai lokasi tersedia.'
    );

    return;
  }

  attendanceType =
    String(
      type || 'MASUK'
    ).toUpperCase();

  capturedDataUrl = '';

  safeText_(
    'cameraTitle',
    attendanceType === 'MASUK'
      ? 'Absen Masuk'
      : 'Absen Pulang'
  );

  resetCameraUI_();

  const modal =
    $('cameraModal');

  if (!modal) {
    return;
  }

  modal.classList.add(
    'show'
  );

  document.body.style.overflow =
    'hidden';

  try {
    await startCamera();

  } catch (error) {
    console.error(
      'Camera error:',
      error
    );

    closeCamera();

    showToast(
      'Kamera tidak dapat dibuka. Pastikan izin kamera diberikan.'
    );
  }
}

function resetCameraUI_() {
  const video =
    $('video');

  const preview =
    $('preview');

  const capture =
    $('captureBtn');

  const submit =
    $('submitPhotoBtn');

  const switchButton =
    $('switchCameraBtn');

  if (video) {
    video.style.display =
      'block';
  }

  if (preview) {
    preview.style.display =
      'none';

    preview.removeAttribute(
      'src'
    );
  }

  if (capture) {
    capture.disabled =
      false;

    capture.innerHTML = `
      <span class="material-symbols-rounded">
        photo_camera
      </span>
      Ambil Foto
    `;
  }

  if (submit) {
    submit.disabled =
      false;

    submit.style.display =
      'none';

    submit.innerHTML = `
      <span class="material-symbols-rounded">
        how_to_reg
      </span>
      Gunakan Foto & Absen
    `;
  }

  if (switchButton) {
    switchButton.disabled =
      false;

    switchButton.innerHTML = `
      <span class="material-symbols-rounded">
        flip_camera_android
      </span>
      Ganti Kamera
    `;
  }
}

async function startCamera() {
  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    throw new Error(
      'Browser tidak mendukung kamera.'
    );
  }

  stopCamera();

  const baseConstraints = {
    video: {
      facingMode: {
        ideal:
          facingMode
      },

      width: {
        ideal: 1280
      },

      height: {
        ideal: 1280
      }
    },

    audio: false
  };

  try {
    cameraStream =
      await navigator.mediaDevices
        .getUserMedia(
          baseConstraints
        );

  } catch (firstError) {
    console.warn(
      'Kamera utama gagal:',
      firstError
    );

    try {
      cameraStream =
        await navigator.mediaDevices
          .getUserMedia({
            video: {
              facingMode
            },
            audio: false
          });

    } catch (secondError) {
      console.warn(
        'Fallback kamera gagal:',
        secondError
      );

      cameraStream =
        await navigator.mediaDevices
          .getUserMedia({
            video: true,
            audio: false
          });
    }
  }

  const video =
    $('video');

  if (!video) {
    stopCamera();

    throw new Error(
      'Elemen video tidak ditemukan.'
    );
  }

  video.srcObject =
    cameraStream;

  video.muted =
    true;

  video.playsInline =
    true;

  try {
    await video.play();
  } catch (error) {
    console.warn(
      'Video play:',
      error
    );
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream
      .getTracks()
      .forEach(track => {
        try {
          track.stop();
        } catch (_) {}
      });

    cameraStream = null;
  }

  const video =
    $('video');

  if (video) {
    try {
      video.pause();
    } catch (_) {}

    video.srcObject =
      null;
  }
}

async function switchCamera() {
  if (attendanceProcessing) {
    return;
  }

  const previous =
    facingMode;

  facingMode =
    facingMode === 'user'
      ? 'environment'
      : 'user';

  const button =
    $('switchCameraBtn');

  if (button) {
    button.disabled =
      true;

    button.innerHTML = `
      <span class="material-symbols-rounded">
        progress_activity
      </span>
      Membuka...
    `;
  }

  try {
    await startCamera();

  } catch (error) {
    console.error(
      error
    );

    facingMode =
      previous;

    showToast(
      'Kamera tidak tersedia.'
    );

  } finally {
    if (button) {
      button.disabled =
        false;

      button.innerHTML = `
        <span class="material-symbols-rounded">
          flip_camera_android
        </span>
        Ganti Kamera
      `;
    }
  }
}


/* ============================================================
   PHOTO CAPTURE
   ============================================================ */

function capturePhoto() {
  if (attendanceProcessing) {
    return;
  }

  const video =
    $('video');

  const canvas =
    $('canvas');

  if (
    !video ||
    !canvas
  ) {
    showToast(
      'Komponen kamera belum siap.'
    );

    return;
  }

  if (
    !video.videoWidth ||
    !video.videoHeight
  ) {
    showToast(
      'Kamera belum siap. Tunggu sebentar.'
    );

    return;
  }

  const MAX_WIDTH =
    800;

  const sourceWidth =
    video.videoWidth;

  const sourceHeight =
    video.videoHeight;

  const ratio =
    sourceHeight /
    sourceWidth;

  const width =
    Math.min(
      MAX_WIDTH,
      sourceWidth
    );

  const height =
    Math.round(
      width * ratio
    );

  canvas.width =
    width;

  canvas.height =
    height;

  const ctx =
    canvas.getContext(
      '2d',
      {
        alpha: false
      }
    );

  if (!ctx) {
    showToast(
      'Canvas kamera tidak tersedia.'
    );

    return;
  }

  ctx.imageSmoothingEnabled =
    true;

  ctx.imageSmoothingQuality =
    'high';

  ctx.drawImage(
    video,
    0,
    0,
    width,
    height
  );

  const MAX_CLIENT_BYTES =
    600 * 1024;

  let quality =
    0.80;

  let dataUrl =
    '';

  for (
    let attempt = 0;
    attempt < 10;
    attempt++
  ) {
    dataUrl =
      canvas.toDataURL(
        'image/jpeg',
        quality
      );

    const estimatedBytes =
      Math.floor(
        dataUrl.length *
        0.75
      );

    if (
      estimatedBytes <=
      MAX_CLIENT_BYTES
    ) {
      break;
    }

    quality =
      Math.max(
        0.35,
        quality - 0.06
      );
  }

  if (
    !/^data:image\/[^;]+;base64,/i.test(
      String(dataUrl || '')
    )
  ) {
    showToast(
      'Foto gagal diproses. Silakan ambil foto lagi.'
    );

    return;
  }

  const finalPhoto =
    String(dataUrl).trim();

  if (
    !finalPhoto ||
    finalPhoto.length < 100
  ) {
    showToast(
      'Foto belum berhasil disimpan.'
    );

    return;
  }

  capturedDataUrl =
    finalPhoto;

  const preview =
    $('preview');

  const videoEl =
    $('video');

  const captureButton =
    $('captureBtn');

  const submitButton =
    $('submitPhotoBtn');

  if (preview) {
    preview.src =
      capturedDataUrl;

    preview.style.display =
      'block';
  }

  if (videoEl) {
    videoEl.style.display =
      'none';
  }

  if (captureButton) {
    captureButton.innerHTML = `
      <span class="material-symbols-rounded">
        replay
      </span>
      Ambil Ulang
    `;
  }

  if (submitButton) {
    submitButton.style.display =
      'flex';
  }

  showToast(
    'Foto berhasil diambil. Periksa foto lalu tekan Gunakan Foto & Absen.'
  );
}


/* ============================================================
   ATTENDANCE SUBMIT
   ============================================================ */

function submitAttendance() {
  if (attendanceProcessing) {
    return;
  }

  const photoToSend =
    String(
      capturedDataUrl || ''
    ).trim();

  if (
    !/^data:image\/[^;]+;base64,/i.test(
      photoToSend
    )
  ) {
    showToast(
      'Foto selfie belum siap. Silakan ambil foto terlebih dahulu.'
    );

    return;
  }

  const locationToSend =
    currentLocation
      ? {
          latitude:
            Number(
              currentLocation.latitude
            ),

          longitude:
            Number(
              currentLocation.longitude
            ),

          accuracy:
            Number(
              currentLocation.accuracy
            )
        }
      : null;

  if (
    !locationToSend ||
    !Number.isFinite(
      locationToSend.latitude
    ) ||
    !Number.isFinite(
      locationToSend.longitude
    ) ||
    !Number.isFinite(
      locationToSend.accuracy
    )
  ) {
    showToast(
      'Lokasi GPS belum siap. Tunggu sampai lokasi tersedia.'
    );

    return;
  }

  if (
    locationToSend.accuracy <= 0
  ) {
    showToast(
      'Akurasi GPS belum valid. Silakan tunggu sebentar.'
    );

    return;
  }

  attendanceProcessing =
    true;

  const submitButton =
    $('submitPhotoBtn');

  const captureButton =
    $('captureBtn');

  const switchButton =
    $('switchCameraBtn');

  if (submitButton) {
    submitButton.disabled =
      true;

    submitButton.innerHTML = `
      <span class="material-symbols-rounded">
        progress_activity
      </span>
      Menyimpan Absensi...
    `;
  }

  if (captureButton) {
    captureButton.disabled =
      true;
  }

  if (switchButton) {
    switchButton.disabled =
      true;
  }

  const photoBackup =
    photoToSend;

  const typeToSend =
    attendanceType;

  closeCamera();

  loading(
    true,
    'Menyimpan Absensi',
    'Mengirim foto, lokasi, dan data absensi...'
  );

  request(
    'attendance',
    {
      type:
        typeToSend,

      latitude:
        locationToSend.latitude,

      longitude:
        locationToSend.longitude,

      accuracy:
        locationToSend.accuracy,

      photo:
        photoToSend
    },
    result => {
      loading(false);

      attendanceProcessing =
        false;

      if (
        !result ||
        !result.ok
      ) {
        capturedDataUrl =
          photoBackup;

        showToast(
          result?.error ||
          'Absen gagal. Silakan coba lagi.'
        );

        restoreCameraAfterSubmitError_();

        const preview =
          $('preview');

        const video =
          $('video');

        const submit =
          $('submitPhotoBtn');

        const modal =
          $('cameraModal');

        if (preview) {
          preview.src =
            capturedDataUrl;

          preview.style.display =
            'block';
        }

        if (video) {
          video.style.display =
            'none';
        }

        if (submit) {
          submit.style.display =
            'flex';
        }

        if (modal) {
          modal.classList.add(
            'show'
          );
        }

        document.body.style.overflow =
          'hidden';

        return;
      }

      safeText_(
        'resultTime',
        (
          result.time ||
          formatAttendanceTime_(
            new Date()
          )
        ) +
        ' WIB'
      );

      safeText_(
        'resultDate',
        result.date || '-'
      );

      safeText_(
        'resultLoc',
        [
          result.district,
          result.regency
        ]
          .filter(Boolean)
          .join(', ') ||
        'Lokasi tercatat'
      );

      const resultPhoto =
        $('resultPhoto');

      if (resultPhoto) {
        resultPhoto.src =
          photoBackup;
      }

      const resultModal =
        $('resultModal');

      if (resultModal) {
        resultModal.classList.add(
          'show'
        );
      }

      document.body.style.overflow =
        'hidden';

      capturedDataUrl = '';

      /*
       * Hanya refresh history.
       * Tidak perlu reload profile/GPS.
       */
      cacheClear_(
        'history'
      );

      request(
        'history',
        {
          limit: 60
        },
        historyResult => {
          if (
            historyResult?.ok
          ) {
            const items =
              historyResult.items ||
              [];

            cacheSet_(
              'history',
              items
            );

            renderHistory(
              items
            );
          }
        }
      );
    }
  );
}

function restoreCameraAfterSubmitError_() {
  const submit =
    $('submitPhotoBtn');

  const capture =
    $('captureBtn');

  const switchButton =
    $('switchCameraBtn');

  if (submit) {
    submit.disabled =
      false;

    submit.innerHTML = `
      <span class="material-symbols-rounded">
        how_to_reg
      </span>
      Gunakan Foto & Absen
    `;
  }

  if (capture) {
    capture.disabled =
      false;

    capture.innerHTML = `
      <span class="material-symbols-rounded">
        replay
      </span>
      Ambil Ulang
    `;
  }

  if (switchButton) {
    switchButton.disabled =
      false;
  }
}

function closeCamera() {
  stopCamera();

  const modal =
    $('cameraModal');

  if (modal) {
    modal.classList.remove(
      'show'
    );
  }

  document.body.style.overflow =
    '';
}


/* ============================================================
   RESULT MODAL
   ============================================================ */

function closeResult() {
  const modal =
    $('resultModal');

  if (modal) {
    modal.classList.remove(
      'show'
    );
  }

  document.body.style.overflow =
    '';

  showPage(
    'home'
  );
}


/* ============================================================
   PAGE NAVIGATION
   ============================================================ */

function showPage(page) {
  const pages = [
    'home',
    'history',
    'request',
    'assignment',
    'profile'
  ];

  pages.forEach(name => {
    const pageEl =
      $(name + 'Page');

    if (pageEl) {
      pageEl.classList.toggle(
        'active',
        name === page
      );
    }
  });

  const navNames = [
    'Home',
    'History',
    'Request',
    'Assignment',
    'Profile'
  ];

  navNames.forEach(name => {
    const navEl =
      $('nav' + name);

    if (navEl) {
      navEl.classList.toggle(
        'active',
        name.toLowerCase() === page
      );
    }
  });

  window.scrollTo({
    top: 0,
    behavior: 'auto'
  });

  if (
    page === 'history'
  ) {
    const cached =
      cacheGet_(
        'history',
        CACHE_TTL.history
      );

    if (cached) {
      renderHistory(
        cached
      );
    } else {
      request(
        'history',
        {
          limit: 60
        },
        result => {
          if (result?.ok) {
            const items =
              result.items ||
              [];

            cacheSet_(
              'history',
              items
            );

            renderHistory(
              items
            );
          }
        }
      );
    }
  }

  if (
    page === 'request'
  ) {
    loadRequests();
  }

  if (
    page === 'assignment'
  ) {
    loadAssignments();
  }
}


/* ============================================================
   LOGOUT
   ============================================================ */

async function logout() {
  if (attendanceProcessing) {
    showToast(
      'Tunggu proses absensi selesai.'
    );

    return;
  }

  loading(
    true,
    'Keluar dari Aplikasi',
    'Mengakhiri sesi login...'
  );

  try {
    if (firebaseAuth) {
      const {
        signOut
      } = await import(
        'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'
      );

      await signOut(
        firebaseAuth
      );
    }

  } catch (error) {
    console.warn(
      'Firebase signOut:',
      error
    );
  }

  localStorage.removeItem(
    'absen_session'
  );

  cacheClearAll_();

  currentLocation =
    null;

  lastLocationAt =
    0;

  locationLookupKey =
    '';

  sessionToken =
    '';

  currentUser =
    null;

  capturedDataUrl =
    '';

  stopCamera();

  window.location.reload();
}


/* ============================================================
   REQUEST / IZIN / CUTI
   ============================================================ */

function setRequestType(type) {
  const value =
    String(
      type || 'IZIN'
    ).toUpperCase();

  const typeInput =
    $('requestType');

  if (typeInput) {
    typeInput.value =
      value;
  }

  const izinTab =
    $('requestTabIzin');

  const cutiTab =
    $('requestTabCuti');

  if (izinTab) {
    izinTab.classList.toggle(
      'active',
      value === 'IZIN'
    );
  }

  if (cutiTab) {
    cutiTab.classList.toggle(
      'active',
      value === 'CUTI'
    );
  }

  const endField =
    $('requestEndField');

  if (endField) {
    endField.style.display =
      value === 'IZIN'
        ? 'none'
        : '';
  }

  const endDate =
    $('requestEndDate');

  if (endDate) {
    endDate.required =
      value === 'CUTI';

    if (
      value === 'IZIN'
    ) {
      endDate.value =
        $('requestStartDate')?.value ||
        '';
    }
  }
}

function formatRequestDate(value) {
  if (!value) {
    return '-';
  }

  const raw =
    String(value);

  const date =
    new Date(
      raw +
      (
        raw.length === 10
          ? 'T00:00:00'
          : ''
      )
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return raw;
  }

  return new Intl.DateTimeFormat(
    'id-ID',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }
  )
    .format(date);
}

function requestStatusClass(status) {
  const value =
    String(
      status || ''
    ).toLowerCase();

  if (
    value.includes('setuju') ||
    value.includes('approve') ||
    value.includes('disetujui')
  ) {
    return 'approved';
  }

  if (
    value.includes('tolak') ||
    value.includes('reject') ||
    value.includes('ditolak')
  ) {
    return 'rejected';
  }

  return 'pending';
}

function renderRequests(items) {
  const el =
    $('requestList');

  if (!el) {
    return;
  }

  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    el.innerHTML =
      `
        <div class="empty-today">
          Belum ada pengajuan.
        </div>
      `;

    return;
  }

  el.innerHTML =
    items
      .map(item => {
        const type =
          String(
            item.type ||
            item.jenis ||
            'PENGAJUAN'
          )
            .toUpperCase();

        const status =
          item.status ||
          item.Status ||
          'Menunggu';

        const start =
          item.startDate ||
          item.tanggalMulai ||
          item.date ||
          '';

        const end =
          item.endDate ||
          item.tanggalSelesai ||
          '';

        const reason =
          item.reason ||
          item.alasan ||
          item.keperluan ||
          '-';

        return `
          <div class="request-item">

            <div class="request-item-head">

              <div>

                <div class="request-item-title">
                  ${esc_(type)}
                </div>

                <div class="request-item-meta">
                  ${esc_(
                    formatRequestDate(
                      start
                    )
                  )}

                  ${
                    end &&
                    end !== start
                      ? ' — ' +
                        esc_(
                          formatRequestDate(
                            end
                          )
                        )
                      : ''
                  }
                </div>

              </div>

              <span
                class="request-status ${escapeHtml(
                  requestStatusClass(
                    status
                  )
                )}"
              >
                ${esc_(status)}
              </span>

            </div>

            <div class="request-item-meta">
              ${esc_(reason)}
            </div>

          </div>
        `;
      })
      .join('');
}

async function loadRequests() {
  if (!sessionToken) {
    return;
  }

  const el =
    $('requestList');

  const cached =
    cacheGet_(
      'requests',
      CACHE_TTL.requests
    );

  if (cached) {
    renderRequests(
      cached
    );

    return;
  }

  if (el) {
    el.innerHTML =
      `
        <div class="empty-today">
          Memuat pengajuan...
        </div>
      `;
  }

  const result =
    await requestPromise_(
      'requests',
      {
        limit: 50
      }
    );

  if (result?.ok) {
    const items =
      result.items ||
      result.data?.items ||
      result.requests ||
      [];

    cacheSet_(
      'requests',
      items
    );

    renderRequests(
      items
    );

  } else if (el) {
    el.innerHTML =
      `
        <div class="empty-today">
          ${esc_(
            result?.error ||
            'Belum dapat memuat pengajuan.'
          )}
        </div>
      `;
  }
}

async function submitRequestForm(event) {
  event?.preventDefault();

  if (!sessionToken) {
    showToast(
      'Sesi login tidak tersedia.'
    );

    return;
  }

  const type =
    $('requestType')?.value ||
    'IZIN';

  const startDate =
    $('requestStartDate')?.value ||
    '';

  const endDate =
    type === 'IZIN'
      ? startDate
      : (
          $('requestEndDate')?.value ||
          ''
        );

  const reason =
    $('requestReason')?.value.trim() ||
    '';

  if (
    !startDate ||
    !reason ||
    (
      type === 'CUTI' &&
      !endDate
    )
  ) {
    showToast(
      'Lengkapi data pengajuan terlebih dahulu.'
    );

    return;
  }

  if (
    type === 'CUTI' &&
    endDate < startDate
  ) {
    showToast(
      'Tanggal selesai tidak boleh sebelum tanggal mulai.'
    );

    return;
  }

  const button =
    $('submitRequestBtn');

  if (button) {
    button.disabled =
      true;

    button.innerHTML = `
      <span class="material-symbols-rounded">
        progress_activity
      </span>
      Mengirim...
    `;
  }

  loading(
    true,
    'Mengirim Pengajuan',
    'Menyimpan pengajuan Anda...'
  );

  try {
    const result =
      await requestPromise_(
        'submitRequest',
        {
          type,
          startDate,
          endDate,
          reason
        }
      );

    if (!result?.ok) {
      throw new Error(
        result?.error ||
        'Pengajuan gagal dikirim.'
      );
    }

    const reasonInput =
      $('requestReason');

    const startInput =
      $('requestStartDate');

    const endInput =
      $('requestEndDate');

    if (reasonInput) {
      reasonInput.value =
        '';
    }

    if (startInput) {
      startInput.value =
        '';
    }

    if (endInput) {
      endInput.value =
        '';
    }

    showToast(
      'Pengajuan berhasil dikirim.'
    );

    cacheClear_(
      'requests'
    );

    await loadRequests();

  } catch (error) {
    console.error(
      'SUBMIT REQUEST ERROR:',
      error
    );

    showToast(
      error?.message ||
      'Pengajuan gagal dikirim.'
    );

  } finally {
    loading(false);

    if (button) {
      button.disabled =
        false;

      button.innerHTML = `
        <span class="material-symbols-rounded">
          send
        </span>
        Kirim Pengajuan
      `;
    }
  }
}


/* ============================================================
   ASSIGNMENTS
   ============================================================ */

function renderAssignments(items) {
  const el =
    $('assignmentList');

  if (!el) {
    return;
  }

  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    el.innerHTML =
      `
        <div class="empty-today">
          Belum ada penugasan.
        </div>
      `;

    return;
  }

  el.innerHTML =
    items
      .map(item => {
        const title =
          item.title ||
          item.judul ||
          item.assignment ||
          item.penugasan ||
          'Penugasan';

        const description =
          item.description ||
          item.deskripsi ||
          item.detail ||
          '';

        const date =
          item.date ||
          item.tanggal ||
          item.startDate ||
          '';

        const status =
          item.status ||
          '';

        return `
          <div class="assignment-item">

            <div class="assignment-item-head">

              <div class="assignment-item-title">
                ${esc_(title)}
              </div>

              ${
                status
                  ? `
                    <span
                      class="request-status ${escapeHtml(
                        requestStatusClass(
                          status
                        )
                      )}"
                    >
                      ${esc_(status)}
                    </span>
                  `
                  : ''
              }

            </div>

            ${
              description
                ? `
                  <div class="assignment-item-desc">
                    ${esc_(description)}
                  </div>
                `
                : ''
            }

            ${
              date
                ? `
                  <div class="assignment-item-date">

                    <span class="material-symbols-rounded">
                      event
                    </span>

                    ${esc_(
                      formatRequestDate(
                        date
                      )
                    )}

                  </div>
                `
                : ''
            }

          </div>
        `;
      })
      .join('');
}

async function loadAssignments() {
  if (!sessionToken) {
    return;
  }

  const el =
    $('assignmentList');

  const cached =
    cacheGet_(
      'assignments',
      CACHE_TTL.assignments
    );

  if (cached) {
    renderAssignments(
      cached
    );

    return;
  }

  if (el) {
    el.innerHTML =
      `
        <div class="empty-today">
          Memuat penugasan...
        </div>
      `;
  }

  const result =
    await requestPromise_(
      'assignments',
      {
        limit: 50
      }
    );

  if (result?.ok) {
    const items =
      result.items ||
      result.data?.items ||
      result.assignments ||
      [];

    cacheSet_(
      'assignments',
      items
    );

    renderAssignments(
      items
    );

  } else if (el) {
    el.innerHTML =
      `
        <div class="empty-today">
          ${esc_(
            result?.error ||
            'Belum dapat memuat penugasan.'
          )}
        </div>
      `;
  }
}


/* ============================================================
   DOM EVENTS
   ============================================================ */

function initDomEvents_() {
  const cameraModal =
    $('cameraModal');

  if (cameraModal) {
    cameraModal.addEventListener(
      'click',
      event => {
        if (
          event.target ===
          cameraModal
        ) {
          closeCamera();
        }
      }
    );
  }

  const resultModal =
    $('resultModal');

  if (resultModal) {
    resultModal.addEventListener(
      'click',
      event => {
        if (
          event.target ===
          resultModal
        ) {
          closeResult();
        }
      }
    );
  }

  document.addEventListener(
    'visibilitychange',
    () => {
      if (
        document.visibilityState ===
        'visible'
      ) {
        updateClock();
      }
    }
  );

  window.addEventListener(
    'beforeunload',
    () => {
      stopCamera();
    }
  );

  document.addEventListener(
    'touchstart',
    () => {},
    {
      passive: true,
      once: true
    }
  );
}


/* ============================================================
   INITIALIZATION
   ============================================================ */

async function initApp_() {
  loading(false);

  updateClock();

  initDomEvents_();

  /*
   * Default request type.
   */
  setRequestType(
    'IZIN'
  );

  /*
   * Firebase dipanaskan di background.
   * Tidak menghambat render halaman.
   */
  initFirebase(false);

  /*
   * Jika session masih tersedia,
   * langsung tampilkan aplikasi.
   */
  if (sessionToken) {
    showApp();

    refreshAll({
      initial: true
    });
  }
}


/* ============================================================
   CLOCK
   ============================================================ */

setInterval(
  updateClock,
  1000
);


/* ============================================================
   DOM READY
   ============================================================ */

if (
  document.readyState ===
  'loading'
) {
  document.addEventListener(
    'DOMContentLoaded',
    initApp_,
    {
      once: true
    }
  );
} else {
  initApp_();
}


/* ============================================================
   OPTIONAL GLOBAL EXPORTS
   Agar onclick="..." pada HTML tetap bekerja.
   ============================================================ */

Object.assign(
  window,
  {
    loginWithFirebase,
    logout,

    openCamera,
    closeCamera,
    switchCamera,
    capturePhoto,
    submitAttendance,

    closeResult,

    showPage,

    getLocation,

    setRequestType,
    submitRequestForm,

    loadRequests,
    loadAssignments
  }
);
