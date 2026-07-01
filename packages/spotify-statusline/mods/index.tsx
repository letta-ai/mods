import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REFRESH_MS = 5_000;
const OSC = "\u001B]8;;";
const ST = "\u001B\\";

type SpotifyStatus =
  | { state: "playing"; href: string; track: string }
  | { state: "paused" }
  | { state: "stopped" };

function terminalLink(label: string, href: string) {
  return `${OSC}${href}${ST}${label}${OSC}${ST}`;
}

async function readSpotifyStatus(): Promise<SpotifyStatus> {
  const script = `
if application "Spotify" is running then
  tell application "Spotify"
    set playerState to player state as string
    if playerState is "playing" then
      set trackArtist to artist of current track
      set trackName to name of current track
      set trackUrl to spotify url of current track
      return "playing|" & trackArtist & " - " & trackName & "|" & trackUrl
    else if playerState is "paused" then
      return "paused|"
    else
      return "stopped|"
    end if
  end tell
else
  return "stopped|"
end if
`;
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: 1_500,
  });
  const [state, track = "", href = ""] = stdout.trim().split("|", 3);

  if (state === "playing" && track.trim()) {
    return { state: "playing", href: href.trim(), track: track.trim() };
  }
  if (state === "paused") return { state: "paused" };
  return { state: "stopped" };
}

function spotifyLabel(status: SpotifyStatus): string {
  if (status.state === "playing") {
    const label = `🎧 ${status.track}`;
    return status.href ? terminalLink(label, status.href) : label;
  }
  if (status.state === "paused") return "🎧 paused";
  return "";
}

export default function activate(letta: any) {
  if (!letta.capabilities.ui?.panels) return;

  let spotifyStatus: SpotifyStatus = { state: "stopped" };

  const panel = letta.ui.openPanel({
    id: "spotify-statusline",
    order: 0,
    render({ width, agent, model, row, chalk }: any) {
      const left = spotifyLabel(spotifyStatus);
      const right = `${chalk.hex("#8b5cf6")(agent.name ?? "Letta")}${chalk.dim(
        ` · ${model.displayName ?? model.id ?? "unknown"}`,
      )}`;
      return row(left ? chalk.hex("#1DB954")(left) : "", right, width);
    },
  });

  const update = () => {
    void readSpotifyStatus()
      .then((status) => {
        spotifyStatus = status;
        panel.update();
      })
      .catch(() => {
        spotifyStatus = { state: "stopped" };
        panel.update();
      });
  };

  update();
  const timer = setInterval(update, REFRESH_MS);

  return () => {
    clearInterval(timer);
    panel.close();
  };
}
