const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  video.srcObject = stream;

  video.addEventListener("loadedmetadata", () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    requestAnimationFrame(tick);
  });
}

function tick() {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  requestAnimationFrame(tick);
}

start().catch(err => {
  console.error(err);
  alert("Camera error: " + err.message + "\nAtidaryk per HTTPS (HFS) ir leisk kamerą.");
});