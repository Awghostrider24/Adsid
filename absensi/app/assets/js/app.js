/* =========================================================
   ABSENSI PEGAWAI - APP.JS
   Firebase Authentication + Google Apps Script
========================================================= */

let sessionToken =
  localStorage.getItem('absen_session') || '';

let currentUser = null;
let currentLocation = null;
let cameraStream = null;
let facingMode = 'user';
let attendanceType = 'MASUK';
let capturedDataUrl = '';
let loginProcessing = false;
let attendanceProcessing = false;


/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  console.log('Absensi Pegawai initialized');

  initializeFirebase();

  updateDateTime();

  setInterval(updateDateTime, 1000);

  if (sessionToken) {
    restoreSession();
  } else {
    showLogin();
  }

});


/* =========================================================
   FIREBASE INITIALIZATION
========================================================= */

function initializeFirebase() {

  try {

    if (!window.firebase) {
      console.error('Firebase SDK belum dimuat.');
      return;
    }

    if (!firebase.apps.length) {

      firebase.initializeApp(
        CONFIG.FIREBASE_CONFIG
      );

    }

    console.log(
      'Firebase initialized:',
      CONFIG.FIREBASE_CONFIG.projectId
    );

  } catch (error) {

    console.error(
      'Firebase initialization error:',
      error
    );

  }

}


/* =========================================================
   LOGIN GOOGLE
========================================================= */

async function loginWithFirebase() {

  if (loginProcessing) {
    return;
  }

  loginProcessing = true;

  const button =
    document.getElementById(
      'firebaseLoginButton'
    );

  try {

    if (!window.firebase) {
      throw new Error(
        'Firebase SDK belum dimuat.'
      );
    }

    if (!firebase.apps.length) {
      initializeFirebase();
    }

    if (button) {

      button.disabled = true;

      button.innerHTML = `
        <span class="google-icon">G</span>
        <span>Memproses login...</span>
      `;

    }

    const provider =
      new firebase.auth.GoogleAuthProvider();

    provider.setCustomParameters({
      prompt: 'select_account'
    });

    showLoading(
      'Login...',
      'Menghubungkan dengan akun Google.'
    );

    const result =
      await firebase.auth()
        .signInWithPopup(provider);

    const user = result.user;

    if (!user || !user.email) {
      throw new Error(
        'Email akun Google tidak ditemukan.'
      );
    }

    console.log(
      'Google login berhasil:',
      user.email
    );

    /*
      Setelah Firebase berhasil,
      cek user ke Google Apps Script.
    */

    showLoading(
      'Memeriksa akun...',
      'Memverifikasi data pegawai.'
    );

    const response =
      const firebaseIdToken =
  await user.getIdToken(true);

const response =
  await apiRequest(
    'firebaseLogin',
    {
      firebaseIdToken
    }
  );

    console.log(
      'Response login:',
      response
    );

    if (!response) {
      throw new Error(
        'Server tidak memberikan respons.'
      );
    }

    if (
      response.success === false ||
      response.status === false
    ) {

      throw new Error(
        response.message ||
        'Akun tidak dapat digunakan.'
      );

    }

    /*
      Simpan session.
    */

    sessionToken =
      response.token ||
      response.sessionToken ||
      response.data?.token ||
      response.data?.sessionToken ||
      '';

    if (sessionToken) {

      localStorage.setItem(
        'absen_session',
        sessionToken
      );

    }

    currentUser =
      response.user ||
      response.data ||
      {
        email: user.email,
        nama:
          user.displayName ||
          user.email,
        photo:
          user.photoURL ||
          ''
      };

    localStorage.setItem(
      'absen_user',
      JSON.stringify(currentUser)
    );

    hideLoading();

    showApp();

    await loadUserData();

    await getLocation(false);

    await loadTodayHistory();

    await loadHistory();

    await loadRequests();

    await loadAssignments();

    showToast(
      'Login berhasil.'
    );

  } catch (error) {

    console.error(
      'LOGIN ERROR:',
      error
    );

    hideLoading();

    try {

      if (
        error.code &&
        error.code !==
        'auth/popup-closed-by-user'
      ) {

        /*
          Jangan signOut untuk error
          backend agar user Firebase
          tetap bisa diperiksa ulang.
        */

      }

    } catch (_) {}

    let message =
      'Login gagal.';

    switch (error.code) {

      case 'auth/popup-closed-by-user':

        message =
          'Jendela login ditutup.';

        break;

      case 'auth/popup-blocked':

        message =
          'Popup login diblokir browser. Izinkan popup untuk situs ini.';

        break;

      case 'auth/network-request-failed':

        message =
          'Koneksi internet bermasalah.';

        break;

      case 'auth/unauthorized-domain':

        message =
          'Domain website belum diizinkan di Firebase Authentication.';

        break;

      default:

        message =
          error.message ||
          'Terjadi kesalahan saat login.';

    }

    showToast(message);

  } finally {

    loginProcessing = false;

    if (button) {

      button.disabled = false;

      button.innerHTML = `
        <span class="google-icon">G</span>
        <span>Masuk dengan Google</span>
      `;

    }

  }

}


/* =========================================================
   RESTORE SESSION
========================================================= */

async function restoreSession() {

  try {

    const savedUser =
      localStorage.getItem(
        'absen_user'
      );

    if (savedUser) {

      try {

        currentUser =
          JSON.parse(savedUser);

      } catch (_) {}

    }

    showLoading(
      'Memuat aplikasi...',
      'Memeriksa sesi login.'
    );

    const response =
      await apiRequest(
        'status',
        {
          token: sessionToken
        }
      );

    if (
      !response ||
      response.success === false ||
      response.status === false
    ) {

      clearSession();

      hideLoading();

      showLogin();

      return;

    }

    currentUser =
      response.user ||
      response.data ||
      currentUser;

    localStorage.setItem(
      'absen_user',
      JSON.stringify(currentUser)
    );

    hideLoading();

    showApp();

    await loadUserData();

    await getLocation(false);

    await loadTodayHistory();

    await loadHistory();

    await loadRequests();

    await loadAssignments();

  } catch (error) {

    console.error(
      'Restore session error:',
      error
    );

    clearSession();

    hideLoading();

    showLogin();

  }

}


/* =========================================================
   API REQUEST
========================================================= */

async function apiRequest(
  action,
  data = {}
) {

  const payload = {

    action,

    ...data

  };

  if (sessionToken) {

    payload.token =
      sessionToken;

  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      30000
    );

  try {

    const response =
      await fetch(
        CONFIG.WEB_APP_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'text/plain;charset=utf-8'
          },

          body:
            JSON.stringify(payload),

          signal:
            controller.signal
        }
      );

    clearTimeout(timeout);

    if (!response.ok) {

      throw new Error(
        `Server HTTP ${response.status}`
      );

    }

    const text =
      await response.text();

    let json;

    try {

      json =
        JSON.parse(text);

    } catch (error) {

      console.error(
        'Invalid JSON:',
        text
      );

      throw new Error(
        'Respons server tidak valid.'
      );

    }

    return json;

  } catch (error) {

    clearTimeout(timeout);

    if (
      error.name ===
      'AbortError'
    ) {

      throw new Error(
        'Waktu tunggu server habis.'
      );

    }

    throw error;

  }

}


/* =========================================================
   USER DATA
========================================================= */

async function loadUserData() {

  try {

    if (!currentUser) {
      return;
    }

    setText(
      'userName',
      getUserName()
    );

    setText(
      'userPosition',
      getUserPosition()
    );

    setText(
      'profileName',
      getUserName()
    );

    setText(
      'profilePosition',
      getUserPosition()
    );

    setText(
      'profileNip',
      currentUser.nip ||
      currentUser.NIP ||
      '-'
    );

    setText(
      'profileEmail',
      currentUser.email ||
      '-'
    );

    setText(
      'profileRole',
      currentUser.role ||
      currentUser.ROLE ||
      '-'
    );

    setText(
      'profileStatus',
      currentUser.status ||
      currentUser.STATUS ||
      'AKTIF'
    );

    const photo =
      currentUser.photo ||
      currentUser.photoURL ||
      '';

    if (photo) {

      setImage(
        'avatar',
        photo
      );

      setImage(
        'profilePhoto',
        photo
      );

    }

  } catch (error) {

    console.error(
      'loadUserData:',
      error
    );

  }

}


/* =========================================================
   LOCATION
========================================================= */

function getLocation(showMessage = false) {

  return new Promise(
    (resolve) => {

      if (!navigator.geolocation) {

        setText(
          'locationText',
          'GPS tidak didukung browser.'
        );

        setText(
          'accuracyText',
          'Gunakan browser yang mendukung lokasi.'
        );

        resolve(null);

        return;

      }

      setText(
        'locationText',
        'Mengambil lokasi...'
      );

      navigator.geolocation.getCurrentPosition(

        position => {

          currentLocation = {

            latitude:
              position.coords.latitude,

            longitude:
              position.coords.longitude,

            accuracy:
              position.coords.accuracy

          };

          setText(
            'locationText',
            `${currentLocation.latitude.toFixed(6)}, ${currentLocation.longitude.toFixed(6)}`
          );

          setText(
            'accuracyText',
            `Akurasi GPS ±${Math.round(currentLocation.accuracy)} meter`
          );

          if (showMessage) {

            showToast(
              'Lokasi berhasil diperbarui.'
            );

          }

          resolve(
            currentLocation
          );

        },

        error => {

          console.error(
            'GPS error:',
            error
          );

          let message =
            'Lokasi tidak tersedia.';

          if (
            error.code ===
            1
          ) {

            message =
              'Izin lokasi ditolak. Silakan izinkan GPS.';

          }

          setText(
            'locationText',
            message
          );

          setText(
            'accuracyText',
            'Mohon aktifkan GPS dan izin lokasi.'
          );

          if (showMessage) {

            showToast(message);

          }

          resolve(null);

        },

        {

          enableHighAccuracy:
            true,

          timeout:
            15000,

          maximumAge:
            30000

        }

      );

    }
  );

}


/* =========================================================
   CAMERA
========================================================= */

async function openCamera(type) {

  if (attendanceProcessing) {
    return;
  }

  attendanceType =
    type || 'MASUK';

  capturedDataUrl = '';

  const modal =
    document.getElementById(
      'cameraModal'
    );

  const video =
    document.getElementById(
      'video'
    );

  const preview =
    document.getElementById(
      'preview'
    );

  const submit =
    document.getElementById(
      'submitPhotoBtn'
    );

  if (!modal || !video) {
    return;
  }

  setText(
    'cameraTitle',
    attendanceType === 'MASUK'
      ? 'Absen Masuk'
      : 'Absen Pulang'
  );

  if (preview) {
    preview.style.display =
      'none';
  }

  if (submit) {
    submit.style.display =
      'none';
  }

  try {

    await getLocation(false);

    if (cameraStream) {
      stopCamera();
    }

    cameraStream =
      await navigator.mediaDevices.getUserMedia(
        {
          video: {
            facingMode:
              facingMode,
            width: {
              ideal: 1280
            },
            height: {
              ideal: 720
            }
          },
          audio: false
        }
      );

    video.srcObject =
      cameraStream;

    video.style.display =
      'block';

    modal.classList.add(
      'show'
    );

  } catch (error) {

    console.error(
      'Camera error:',
      error
    );

    showToast(
      'Kamera tidak dapat digunakan. Pastikan izin kamera diberikan.'
    );

  }

}


/* =========================================================
   SWITCH CAMERA
========================================================= */

async function switchCamera() {

  facingMode =
    facingMode === 'user'
      ? 'environment'
      : 'user';

  if (
    !document
      .getElementById(
        'cameraModal'
      )
      ?.classList.contains('show')
  ) {

    return;

  }

  try {

    stopCamera();

    cameraStream =
      await navigator.mediaDevices.getUserMedia(
        {
          video: {
            facingMode:
              facingMode,
            width: {
              ideal: 1280
            },
            height: {
              ideal: 720
            }
          },
          audio: false
        }
      );

    const video =
      document.getElementById(
        'video'
      );

    if (video) {

      video.srcObject =
        cameraStream;

    }

  } catch (error) {

    console.error(
      'Switch camera:',
      error
    );

    showToast(
      'Tidak dapat mengganti kamera.'
    );

  }

}


/* =========================================================
   CAPTURE PHOTO
========================================================= */

function capturePhoto() {

  const video =
    document.getElementById(
      'video'
    );

  const canvas =
    document.getElementById(
      'canvas'
    );

  const preview =
    document.getElementById(
      'preview'
    );

  const submit =
    document.getElementById(
      'submitPhotoBtn'
    );

  if (
    !video ||
    !canvas ||
    !video.videoWidth
  ) {

    showToast(
      'Kamera belum siap.'
    );

    return;

  }

  canvas.width =
    video.videoWidth;

  canvas.height =
    video.videoHeight;

  const ctx =
    canvas.getContext(
      '2d'
    );

  if (facingMode === 'user') {

    ctx.translate(
      canvas.width,
      0
    );

    ctx.scale(
      -1,
      1
    );

  }

  ctx.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  capturedDataUrl =
    canvas.toDataURL(
      'image/jpeg',
      0.82
    );

  if (preview) {

    preview.src =
      capturedDataUrl;

    preview.style.display =
      'block';

  }

  video.style.display =
    'none';

  if (submit) {

    submit.style.display =
      'flex';

  }

  stopCamera();

}


/* =========================================================
   SUBMIT ATTENDANCE
========================================================= */

async function submitAttendance() {

  if (attendanceProcessing) {
    return;
  }

  if (!capturedDataUrl) {

    showToast(
      'Silakan ambil foto terlebih dahulu.'
    );

    return;

  }

  if (!currentLocation) {

    await getLocation(false);

  }

  if (!currentLocation) {

    showToast(
      'Lokasi GPS belum tersedia.'
    );

    return;

  }

  attendanceProcessing =
    true;

  try {

    showLoading(
      'Menyimpan absensi...',
      'Mengirim foto, lokasi, dan waktu.'
    );

    const response =
      await apiRequest(
        'attendance',
        {

          type:
            attendanceType,

          attendanceType:
            attendanceType,

          latitude:
            currentLocation.latitude,

          longitude:
            currentLocation.longitude,

          accuracy:
            currentLocation.accuracy,

          photo:
            capturedDataUrl

        }
      );

    hideLoading();

    if (
      !response ||
      response.success === false
    ) {

      throw new Error(
        response?.message ||
        'Absensi gagal disimpan.'
      );

    }

    closeCamera();

    const data =
      response.data ||
      response;

    showResult(
      data
    );

    await loadTodayHistory();

    await loadHistory();

  } catch (error) {

    hideLoading();

    console.error(
      'Attendance error:',
      error
    );

    showToast(
      error.message ||
      'Gagal menyimpan absensi.'
    );

  } finally {

    attendanceProcessing =
      false;

  }

}


/* =========================================================
   TODAY HISTORY
========================================================= */

async function loadTodayHistory() {

  try {

    const container =
      document.getElementById(
        'todayHistory'
      );

    if (!container) {
      return;
    }

    const response =
      await apiRequest(
        'history',
        {
          limit: 2
        }
      );

    const rows =
      response?.data ||
      response?.history ||
      [];

    renderTodayHistory(
      rows
    );

  } catch (error) {

    console.error(
      'Today history:',
      error
    );

  }

}


/* =========================================================
   HISTORY
========================================================= */

async function loadHistory() {

  try {

    const container =
      document.getElementById(
        'historyList'
      );

    if (!container) {
      return;
    }

    const response =
      await apiRequest(
        'history',
        {}
      );

    const rows =
      response?.data ||
      response?.history ||
      [];

    renderHistory(
      rows
    );

  } catch (error) {

    console.error(
      'History error:',
      error
    );

  }

}


/* =========================================================
   REQUEST
========================================================= */

function setRequestType(type) {

  setText(
    'requestType',
    type
  );

  const input =
    document.getElementById(
      'requestType'
    );

  if (input) {
    input.value =
      type;
  }

  document
    .getElementById(
      'requestTabIzin'
    )
    ?.classList.toggle(
      'active',
      type === 'IZIN'
    );

  document
    .getElementById(
      'requestTabCuti'
    )
    ?.classList.toggle(
      'active',
      type === 'CUTI'
    );

}


async function submitRequestForm(event) {

  event.preventDefault();

  const type =
    document.getElementById(
      'requestType'
    )?.value ||
    'IZIN';

  const start =
    document.getElementById(
      'requestStartDate'
    )?.value;

  const end =
    document.getElementById(
      'requestEndDate'
    )?.value;

  const reason =
    document.getElementById(
      'requestReason'
    )?.value.trim();

  if (!start || !end || !reason) {

    showToast(
      'Lengkapi formulir pengajuan.'
    );

    return;

  }

  try {

    showLoading(
      'Mengirim pengajuan...',
      'Mohon tunggu.'
    );

    const response =
      await apiRequest(
        'submitRequest',
        {

          type,

          startDate:
            start,

          endDate:
            end,

          reason

        }
      );

    hideLoading();

    if (
      !response ||
      response.success === false
    ) {

      throw new Error(
        response?.message ||
        'Pengajuan gagal dikirim.'
      );

    }

    document
      .getElementById(
        'requestForm'
      )
      ?.reset();

    setRequestType(
      'IZIN'
    );

    showToast(
      'Pengajuan berhasil dikirim.'
    );

    await loadRequests();

  } catch (error) {

    hideLoading();

    showToast(
      error.message ||
      'Gagal mengirim pengajuan.'
    );

  }

}


/* =========================================================
   REQUEST HISTORY
========================================================= */

async function loadRequests() {

  try {

    const container =
      document.getElementById(
        'requestList'
      );

    if (!container) {
      return;
    }

    const response =
      await apiRequest(
        'requests',
        {}
      );

    const rows =
      response?.data ||
      response?.requests ||
      [];

    renderRequests(
      rows
    );

  } catch (error) {

    console.error(
      'Request history:',
      error
    );

  }

}


/* =========================================================
   ASSIGNMENT
========================================================= */

async function loadAssignments() {

  try {

    const container =
      document.getElementById(
        'assignmentList'
      );

    if (!container) {
      return;
    }

    const response =
      await apiRequest(
        'assignments',
        {}
      );

    const rows =
      response?.data ||
      response?.assignments ||
      [];

    renderAssignments(
      rows
    );

  } catch (error) {

    console.error(
      'Assignment:',
      error
    );

    container.innerHTML = `
      <div class="empty-today">
        Gagal memuat penugasan.
      </div>
    `;

  }

}


/* =========================================================
   PAGE NAVIGATION
========================================================= */

function showPage(page) {

  const pages = [
    'home',
    'history',
    'request',
    'assignment',
    'profile'
  ];

  pages.forEach(
    item => {

      const element =
        document.getElementById(
          item + 'Page'
        );

      if (element) {

        element.classList.toggle(
          'active',
          item === page
        );

      }

      const nav =
        document.getElementById(
          'nav' +
          item.charAt(0).toUpperCase() +
          item.slice(1)
        );

      if (nav) {

        nav.classList.toggle(
          'active',
          item === page
        );

      }

    }
  );

}


/* =========================================================
   SHOW / HIDE APP
========================================================= */

function showLogin() {

  const login =
    document.getElementById(
      'loginView'
    );

  const app =
    document.getElementById(
      'appView'
    );

  if (login) {
    login.style.display =
      'flex';
  }

  if (app) {
    app.style.display =
      'none';
  }

}


function showApp() {

  const login =
    document.getElementById(
      'loginView'
    );

  const app =
    document.getElementById(
      'appView'
    );

  if (login) {
    login.style.display =
      'none';
  }

  if (app) {
    app.style.display =
      'block';
  }

}


/* =========================================================
   LOGOUT
========================================================= */

async function logout() {

  try {

    showLoading(
      'Keluar...',
      'Menghapus sesi login.'
    );

    if (
      window.firebase &&
      firebase.auth
    ) {

      async function logout() {

  try {

    showLoading(
      'Keluar...',
      'Menghapus sesi login.'
    );

    if (sessionToken) {
      try {
        await apiRequest('logout', {
          sessionToken
        });
      } catch (error) {
        console.error(
          'Server logout:',
          error
        );
      }
    }

    if (
      window.firebase &&
      firebase.auth
    ) {
      await firebase.auth().signOut();
    }

  } catch (error) {

    console.error(
      'Firebase logout:',
      error
    );

  } finally {

    clearSession();

    hideLoading();

    showLogin();

    showToast(
      'Anda telah keluar.'
    );

  }

}

  } catch (error) {

    console.error(
      'Firebase logout:',
      error
    );

  } finally {

    clearSession();

    hideLoading();

    showLogin();

    showToast(
      'Anda telah keluar.'
    );

  }

}


function clearSession() {

  sessionToken = '';

  currentUser = null;

  localStorage.removeItem(
    'absen_session'
  );

  localStorage.removeItem(
    'absen_user'
  );

}


/* =========================================================
   CAMERA CLOSE
========================================================= */

function closeCamera() {

  stopCamera();

  const modal =
    document.getElementById(
      'cameraModal'
    );

  if (modal) {

    modal.classList.remove(
      'show'
    );

  }

}


function stopCamera() {

  if (cameraStream) {

    cameraStream
      .getTracks()
      .forEach(
        track => track.stop()
      );

    cameraStream =
      null;

  }

  const video =
    document.getElementById(
      'video'
    );

  if (video) {
    video.srcObject =
      null;
  }

}


/* =========================================================
   RESULT
========================================================= */

function showResult(data = {}) {

  const modal =
    document.getElementById(
      'resultModal'
    );

  if (!modal) {
    return;
  }

  const time =
    data.time ||
    data.jam ||
    formatTime(
      new Date()
    );

  const date =
    data.date ||
    data.tanggal ||
    formatDate(
      new Date()
    );

  setText(
    'resultTime',
    time
  );

  setText(
    'resultDate',
    date
  );

  setText(
    'resultLoc',
    currentLocation
      ? `${currentLocation.latitude.toFixed(6)}, ${currentLocation.longitude.toFixed(6)}`
      : 'Lokasi tercatat'
  );

  const photo =
    document.getElementById(
      'resultPhoto'
    );

  if (
    photo &&
    capturedDataUrl
  ) {

    photo.src =
      capturedDataUrl;

  }

  modal.classList.add(
    'show'
  );

}


function closeResult() {

  document
    .getElementById(
      'resultModal'
    )
    ?.classList.remove(
      'show'
    );

}


/* =========================================================
   LOADING
========================================================= */

function showLoading(
  title = 'Memuat...',
  text = 'Mohon tunggu sebentar.'
) {

  const loading =
    document.getElementById(
      'loading'
    );

  setText(
    'loadingTitle',
    title
  );

  setText(
    'loadingText',
    text
  );

  if (loading) {

    loading.classList.add(
      'show'
    );

  }

}


function hideLoading() {

  document
    .getElementById(
      'loading'
    )
    ?.classList.remove(
      'show'
    );

}


/* =========================================================
   TOAST
========================================================= */

function showToast(message) {

  const toast =
    document.getElementById(
      'toast'
    );

  if (!toast) {

    console.log(
      message
    );

    return;

  }

  toast.textContent =
    message;

  toast.classList.add(
    'show'
  );

  clearTimeout(
    window.toastTimer
  );

  window.toastTimer =
    setTimeout(
      () => {

        toast.classList.remove(
          'show'
        );

      },
      3500
    );

}


/* =========================================================
   DATE / CLOCK
========================================================= */

function updateDateTime() {

  const now =
    new Date();

  setText(
    'dateText',
    formatDate(now)
  );

  setText(
    'clockText',
    formatTime(now)
  );

  const hour =
    now.getHours();

  let greeting =
    'Selamat Datang';

  if (hour >= 4 && hour < 11) {

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

  setText(
    'greetingText',
    greeting
  );

}


/* =========================================================
   RENDER TODAY HISTORY
========================================================= */

function renderTodayHistory(rows) {

  const container =
    document.getElementById(
      'todayHistory'
    );

  if (!container) {
    return;
  }

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {

    container.innerHTML = `
      <div class="empty-today">
        <span class="material-symbols-rounded">
          event_available
        </span>
        Belum ada aktivitas absensi hari ini.
      </div>
    `;

    return;

  }

  container.innerHTML =
    rows.slice(0, 10)
      .map(
        row => {

          const type =
            row.type ||
            row.jenis ||
            row.attendanceType ||
            '-';

          const time =
            row.time ||
            row.jam ||
            row.waktu ||
            '-';

          return `
            <div class="history-item">
              <div>
                <strong>
                  ${escapeHtml(type)}
                </strong>
                <small>
                  ${escapeHtml(time)}
                </small>
              </div>
            </div>
          `;

        }
      )
      .join('');

}


/* =========================================================
   RENDER HISTORY
========================================================= */

function renderHistory(rows) {

  const container =
    document.getElementById(
      'historyList'
    );

  if (!container) {
    return;
  }

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {

    container.innerHTML = `
      <div class="empty-today">
        Belum ada riwayat absensi.
      </div>
    `;

    return;

  }

  container.innerHTML =
    rows.map(
      row => {

        const date =
          row.date ||
          row.tanggal ||
          '-';

        const type =
          row.type ||
          row.jenis ||
          '-';

        const time =
          row.time ||
          row.jam ||
          row.waktu ||
          '-';

        return `
          <div class="history-item">
            <div>
              <strong>
                ${escapeHtml(type)}
              </strong>
              <small>
                ${escapeHtml(date)}
              </small>
            </div>

            <strong>
              ${escapeHtml(time)}
            </strong>
          </div>
        `;

      }
    )
    .join('');

}


/* =========================================================
   RENDER REQUEST
========================================================= */

function renderRequests(rows) {

  const container =
    document.getElementById(
      'requestList'
    );

  if (!container) {
    return;
  }

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {

    container.innerHTML = `
      <div class="empty-today">
        Belum ada pengajuan.
      </div>
    `;

    return;

  }

  container.innerHTML =
    rows.map(
      row => {

        const type =
          row.type ||
          row.jenis ||
          '-';

        const status =
          row.status ||
          'DIAJUKAN';

        const start =
          row.startDate ||
          row.tanggalMulai ||
          '-';

        const end =
          row.endDate ||
          row.tanggalSelesai ||
          '-';

        const reason =
          row.reason ||
          row.alasan ||
          '';

        return `
          <div class="request-item">

            <div>
              <strong>
                ${escapeHtml(type)}
              </strong>

              <div>
                ${escapeHtml(start)}
                s/d
                ${escapeHtml(end)}
              </div>

              <small>
                ${escapeHtml(reason)}
              </small>
            </div>

            <span>
              ${escapeHtml(status)}
            </span>

          </div>
        `;

      }
    )
    .join('');

}


/* =========================================================
   RENDER ASSIGNMENT
========================================================= */

function renderAssignments(rows) {

  const container =
    document.getElementById(
      'assignmentList'
    );

  if (!container) {
    return;
  }

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {

    container.innerHTML = `
      <div class="empty-today">
        Belum ada penugasan.
      </div>
    `;

    return;

  }

  container.innerHTML =
    rows.map(
      row => {

        const title =
          row.title ||
          row.judul ||
          row.nama ||
          'Penugasan';

        const date =
          row.date ||
          row.tanggal ||
          '';

        const location =
          row.location ||
          row.lokasi ||
          '';

        const status =
          row.status ||
          '';

        return `
          <div class="assignment-item">

            <strong>
              ${escapeHtml(title)}
            </strong>

            <small>
              ${escapeHtml(date)}
            </small>

            <small>
              ${escapeHtml(location)}
            </small>

            <span>
              ${escapeHtml(status)}
            </span>

          </div>
        `;

      }
    )
    .join('');

}


/* =========================================================
   HELPERS
========================================================= */

function getUserName() {

  if (!currentUser) {
    return '-';
  }

  return (
    currentUser.nama ||
    currentUser.name ||
    currentUser.Nama ||
    currentUser.NAME ||
    currentUser.displayName ||
    currentUser.email ||
    '-'
  );

}


function getUserPosition() {

  if (!currentUser) {
    return '-';
  }

  return (
    currentUser.jabatan ||
    currentUser.position ||
    currentUser.posisi ||
    currentUser.Jabatan ||
    '-'
  );

}


function setText(
  id,
  value
) {

  const element =
    document.getElementById(id);

  if (element) {

    element.textContent =
      value == null
        ? ''
        : value;

  }

}


function setImage(
  id,
  src
) {

  const element =
    document.getElementById(id);

  if (element && src) {

    element.src =
      src;

  }

}


function formatDate(date) {

  return new Intl.DateTimeFormat(
    'id-ID',
    {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone:
        'Asia/Jakarta'
    }
  ).format(date);

}


function formatTime(date) {

  return new Intl.DateTimeFormat(
    'id-ID',
    {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone:
        'Asia/Jakarta'
    }
  ).format(date) + ' WIB';

}


function escapeHtml(value) {

  return String(
    value ?? ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );

}


/* =========================================================
   GLOBAL EXPORT
   Memastikan onclick="" di HTML dapat menemukan fungsi.
========================================================= */

window.loginWithFirebase =
  loginWithFirebase;

window.logout =
  logout;

window.openCamera =
  openCamera;

window.closeCamera =
  closeCamera;

window.switchCamera =
  switchCamera;

window.capturePhoto =
  capturePhoto;

window.submitAttendance =
  submitAttendance;

window.closeResult =
  closeResult;

window.getLocation =
  getLocation;

window.showPage =
  showPage;

window.setRequestType =
  setRequestType;

window.submitRequestForm =
  submitRequestForm;

window.loadHistory =
  loadHistory;

window.loadRequests =
  loadRequests;

window.loadAssignments =
  loadAssignments;
