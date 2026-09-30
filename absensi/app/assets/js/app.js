let sessionToken =
localStorage.getItem(
'absen_session'
) || '';

let currentUser =
null;

let currentLocation =
null;

let cameraStream =
null;

let facingMode =
'user';

let attendanceType =
'MASUK';

let capturedDataUrl =
'';

let loginProcessing =
false;

let attendanceProcessing =
