import { ChatWorkspaceProvider } from "../chat-workspace/store/chatWorkspaceStore";
import { AdConnectMock } from "./AdConnectMock";
import { FloatingWidget } from "./FloatingWidget";
import { AppErrorBoundary } from "./AppErrorBoundary";

function MainLayoutInner() {
  return (
    <>
      <AdConnectMock />
      <FloatingWidget />
    </>
  );
}

export function MainLayout() {
  return (
    <ChatWorkspaceProvider>
      <AppErrorBoundary title="Ошибка интерфейса">
        <MainLayoutInner />
      </AppErrorBoundary>
    </ChatWorkspaceProvider>
  );
}
