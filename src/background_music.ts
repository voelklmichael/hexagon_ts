// ── Music Player Logic ──
// Note: Move your MP3 files to the 'public/music/' directory.
// and that the paths are relative to the root of your website.
const TRACKS = [
    { name: "Playful Night", src: "private_assets/alexzavesa-dance-playful-night-510786.mp3" },
    { name: "Phonk", src: "private_assets/freemusiclab-charming-phonk-i-free-background-music-i-free-music-lab-release-513626.mp3" },
    { name: "Happy Corporate", src: "private_assets/kornevmusic-upbeat-happy-corporate-487426.mp3" },
    { name: "Joyful", src: "private_assets/lightbeatsmusic-joyful-rhythm-walk-funk-513936.mp3" },
    { name: "magpiemusic", src: "private_assets/magpiemusic-action-race-rock-music-513682.mp3" },
    { name: "miromaxmusic", src: "private_assets/miromaxmusic-music-promotion-no-copyright-513944.mp3" },
    { name: "starostin", src: "private_assets/starostin-comedy-cartoon-funny-background-music-492540.mp3" },
];

let currentTrackIdx = 0;
const audio = new Audio();
audio.loop = true;

export function initMusicAutoplay(): void {
    const handleInteraction = () => {
        if (audio.paused) {
            const target = TRACKS[currentTrackIdx]?.src;

            // Check if audio.src is empty or just pointing to the current page (common default)
            const isUnset = !audio.src ||
                audio.src === window.location.href ||
                audio.src === window.location.origin + "/";

            if (target && isUnset) {
                audio.src = target;
                audio.load();
            }
            audio.play()
                .then(() => renderMusicView())
                .catch(err => console.warn("Autoplay failed:", err));
        }
        window.removeEventListener("click", handleInteraction);
        window.removeEventListener("keydown", handleInteraction);
    };
    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);
}

export function renderMusicView(): void {
    const view = document.getElementById("music-view");
    if (!view) return;

    const track = TRACKS[currentTrackIdx];
    view.innerHTML = `
    <div class="music-player-container">
      <div class="track-info">
        <div class="track-name"><strong>${track ? track.name : "No track selected"}</strong></div>
        <div class="track-status">${audio.paused ? "Paused" : "Playing"}</div>
      </div>
      <div class="music-controls">
        <button id="music-prev-btn" class="ctrl-btn">⏮</button>
        <button id="music-toggle-btn" class="ctrl-btn main">${audio.paused ? "⏵" : "⏸"}</button>
        <button id="music-next-btn" class="ctrl-btn">⏭</button>
      </div>
      <div class="volume-row">
        <span>Volume</span>
        <input type="range" id="music-volume" min="0" max="1" step="0.05" value="${audio.volume}">
      </div>
    </div>
  `;

    view.querySelector("#music-toggle-btn")?.addEventListener("click", () => {
        if (audio.paused) {
            const target = TRACKS[currentTrackIdx]?.src;

            const isUnset = !audio.src ||
                audio.src === window.location.href ||
                audio.src === window.location.origin + "/";

            if (target && isUnset) {
                audio.src = target;
                audio.load();
            }
            audio.play().catch(e => console.error("Playback failed:", e));
        } else {
            audio.pause();
        }
        renderMusicView();
    });

    const changeTrack = (delta: number) => {
        currentTrackIdx = (currentTrackIdx + delta + TRACKS.length) % TRACKS.length;
        audio.src = TRACKS[currentTrackIdx]!.src;
        audio.play().catch(console.error);
        renderMusicView();
    };

    view.querySelector("#music-prev-btn")?.addEventListener("click", () => changeTrack(-1));
    view.querySelector("#music-next-btn")?.addEventListener("click", () => changeTrack(1));
    view.querySelector("#music-volume")?.addEventListener("input", (e) => {
        audio.volume = Number((e.target as HTMLInputElement).value);
    });
}