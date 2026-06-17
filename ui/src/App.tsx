import { AwarenessPane } from "./components/AwarenessPane";
import { useAwarenessStream } from "./hooks/useAwarenessStream";

function applyInitialTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", saved === "dark" || (!saved && prefersDark));
}

applyInitialTheme();

export default function App() {
  const stream = useAwarenessStream();

  return (
    <div className="workspace-root embed-mode flight-chat-root">
      <div className="awareness-sidebar flight-awareness-sidebar">
        <AwarenessPane
          stream={stream}
          allowCommands={false}
          allowSettings={false}
          allowVoice={false}
          showChannels
        />
      </div>
    </div>
  );
}
