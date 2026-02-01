import { useState } from "react";
import { Terminal } from "./components/Terminal";

function App() {
  const [sessionId] = useState(() => crypto.randomUUID());

  return (
    <div className="h-screen w-screen bg-gray-900 flex flex-col">
      <header className="h-10 bg-gray-800 flex items-center px-4 border-b border-gray-700">
        <span className="text-white font-medium">Claude Maestro</span>
        <span className="ml-2 text-xs text-gray-400">v2.0.0</span>
      </header>
      <main className="flex-1 p-2">
        <div className="h-full w-full rounded-lg overflow-hidden border border-gray-700">
          <Terminal sessionId={sessionId} />
        </div>
      </main>
    </div>
  );
}

export default App;
