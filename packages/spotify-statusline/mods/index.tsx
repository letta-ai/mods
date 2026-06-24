import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REFRESH_MS = 5_000;
const OSC = "\u001B]8;;";
const ST = "\u001B\\";

function terminalLink(label: string, href: string) {
  return `${OSC}${href}${ST}${label}${OSC}${ST}`;
}

async function updateSpotify(letta: any) {
  try {
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
    const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 1_500 });
    const [state, track = "", href = ""] = stdout.trim().split("|", 3);

    if (state === "playing" && track.trim()) {
      const label = `🎧 ${track.trim()}`;
      letta.ui.setStatus("spotify", href.trim() ? terminalLink(label, href.trim()) : label);
    } else if (state === "paused") {
      letta.ui.setStatus("spotify", "🎧 paused");
    } else {
      letta.ui.clearStatus("spotify");
    }
  } catch {
    letta.ui.clearStatus("spotify");
  }
}

export default function activate(letta: any) {
  if (!letta.capabilities.ui.customStatuslineRenderer) return;

  const update = () => {
    if (!letta.capabilities.ui.statusValues) return;
    void updateSpotify(letta);
  };

  letta.ui.setStatuslineRenderer((context: any) => {
    const { Box, Text } = context.components;
    const model = context.model.displayName ?? context.model.id ?? "unknown";

    return (
      <Box flexDirection="row" marginBottom={1}>
        <Box flexGrow={1} paddingRight={1}>
          {context.statuses.spotify ? <Text color="#1DB954">{context.statuses.spotify}</Text> : null}
        </Box>
        <Text>
          <Text color="#8b5cf6">{context.agent.name ?? "Letta"}</Text>
          <Text dimColor>{` · ${model}`}</Text>
        </Text>
      </Box>
    );
  });

  update();
  const timer = setInterval(update, REFRESH_MS);

  return () => {
    clearInterval(timer);
    if (letta.capabilities.ui.statusValues) {
      letta.ui.clearStatus("spotify");
    }
  };
}
